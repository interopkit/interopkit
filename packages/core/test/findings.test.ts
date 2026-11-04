import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
  buildFindings,
  buildIssues,
  createFindingSink,
  createIssueSink,
  DEFAULT_MAX_FINDINGS,
  safeParseBounded,
} from "../src/checks.js";

/** A finding of a package, which adds a severity to those of the core. */
interface Issue {
  readonly path: string;
  readonly rule: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

const issue = (path: string, severity: Issue["severity"] = "error"): Issue => ({
  path,
  rule: "rule",
  message: "m",
  severity,
});
const stop = (finding: { readonly path: string; readonly rule: string; readonly message: string }): Issue => ({
  ...finding,
  severity: "error",
});

describe("createFindingSink", () => {
  it("holds findings up to the limit and is not stopped when the limit is the number of findings", () => {
    const sink = createFindingSink(2, stop);
    sink.add([issue("a"), issue("b")]);
    expect(sink.room).toBe(0);
    expect(sink.stopped).toBe(false);
    expect(sink.list().map(({ path }) => path)).toStrictEqual(["a", "b"]);
  });

  it("drops the first finding beyond the limit and ends the list with a finding that says it stopped", () => {
    const sink = createFindingSink(2, stop);
    sink.add([issue("a"), issue("b"), issue("c"), issue("d")]);
    sink.add([issue("e")]);
    expect(sink.stopped).toBe(true);
    expect(sink.list()).toStrictEqual([
      issue("a"),
      issue("b"),
      {
        path: "",
        rule: "findings-stopped",
        message: "the check stopped after 2 findings, so there may be more.",
        severity: "error",
      },
    ]);
  });

  it("counts the room left and does not count a finding it does not keep", () => {
    const sink = createFindingSink(2, stop, ({ severity }) => severity === "error");
    sink.add([issue("w", "warning"), issue("a"), issue("x", "warning"), issue("y", "warning")]);
    expect(sink.room).toBe(1);
    expect(sink.stopped).toBe(false);
    expect(sink.list()).toStrictEqual([issue("a")]);
  });

  it("gives a view that changes the findings it is given and fills the same list", () => {
    const sink = createFindingSink(3, stop);
    const entry = sink.within((finding) => ({ ...finding, path: `[1].${finding.path}` }));
    const inner = entry.within((finding) => ({ ...finding, path: `x.${finding.path}` }));
    entry.add([issue("a")]);
    inner.add([issue("b")]);
    expect(entry.room).toBe(1);
    expect(entry.stopped).toBe(false);
    inner.add([issue("c"), issue("d")]);
    expect(inner.stopped).toBe(true);
    expect(entry.list().map(({ path }) => path)).toStrictEqual(["[1].a", "[1].x.b", "[1].x.c", ""]);
    expect(sink.list()).toHaveLength(4);
  });

  it("defaults to a limit of 1,000", () => {
    expect(DEFAULT_MAX_FINDINGS).toBe(1000);
  });
});

describe("safeParseBounded", () => {
  const item = v.object({ id: v.string(), name: v.string(), tags: v.array(v.string()) });
  const schema = v.object({ items: v.array(item) });
  const wrong = (count: number) => ({ items: Array.from({ length: count }, () => ({})) });

  it("reads a value that is right as v.safeParse does", () => {
    const value = { items: [{ id: "a", name: "b", tags: ["c"] }] };
    const parsed = safeParseBounded(schema, value, 0);
    expect(parsed).toStrictEqual({ success: true, output: value, issues: [] });
  });

  it("finds every issue of a value that has no more than the limit, in the order of v.safeParse", () => {
    const value = wrong(4);
    const full = v.safeParse(schema, value);
    const parsed = safeParseBounded(schema, value, 12);
    expect(full.issues).toHaveLength(12);
    expect(parsed.success).toBe(false);
    expect(buildFindings(parsed.issues)).toStrictEqual(buildFindings(full.issues ?? []));
  });

  it("stops at the first issue beyond the limit and reads no further", () => {
    const parsed = safeParseBounded(schema, wrong(100_000), 10);
    // Each entry has three missing properties, so the issue beyond the limit is the second of the fourth entry.
    expect(parsed.issues).toHaveLength(11);
    expect(buildFindings(parsed.issues)).toStrictEqual(
      buildFindings(v.safeParse(schema, wrong(4)).issues?.slice(0, 11) ?? []),
    );
  });

  it("bounds the issues of a list of numbers where strings belong", () => {
    const parsed = safeParseBounded(
      v.array(v.string()),
      Array.from({ length: 1_000_000 }, () => 0),
      1000,
    );
    expect(parsed.issues).toHaveLength(1001);
  });

  it("reads a value again with no limit when a union made issues that it threw away", () => {
    const either = v.array(v.union([v.number(), v.string()]));
    const value = Array.from({ length: 50 }, () => "text");
    const parsed = safeParseBounded(either, value, 10);
    expect(parsed.success).toBe(true);
    expect(parsed.output).toStrictEqual(value);
    const bad = safeParseBounded(either, [true, ...value], 10);
    expect(bad.success).toBe(false);
    expect(bad.issues).toHaveLength(1);
  });
});

describe("createIssueSink", () => {
  it("keeps the errors alone for a reader, and does not count a warning toward the limit", () => {
    const sink = createIssueSink(2, true);
    sink.add([issue("w", "warning"), issue("a"), issue("x", "warning"), issue("b")]);
    expect(sink.room).toBe(0);
    expect(sink.stopped).toBe(false);
    expect(sink.list()).toStrictEqual([issue("a"), issue("b")]);
  });

  it("keeps every issue for a validator", () => {
    const sink = createIssueSink(3, false);
    sink.add([issue("w", "warning"), issue("a"), issue("x", "warning")]);
    expect(sink.list()).toStrictEqual([issue("w", "warning"), issue("a"), issue("x", "warning")]);
  });

  it("ends a list that stopped with an error that says so", () => {
    const sink = createIssueSink(1, true);
    sink.add([issue("a"), issue("b")]);
    expect(sink.stopped).toBe(true);
    expect(sink.list()).toStrictEqual([
      issue("a"),
      {
        path: "",
        rule: "findings-stopped",
        message: "the check stopped after 1 findings, so there may be more.",
        severity: "error",
      },
    ]);
  });
});

describe("buildIssues", () => {
  it("gives the findings of the issues of a parse, each an error", () => {
    const parsed = v.safeParse(v.object({ id: v.string(), count: v.number() }), { id: 1, extra: true });
    const issues = buildIssues(parsed.issues ?? []);
    expect(issues).toStrictEqual(
      buildFindings(parsed.issues ?? []).map((finding) => ({ ...finding, severity: "error" })),
    );
    expect(issues.length).toBeGreaterThan(1);
    expect(new Set(issues.map(({ severity }) => severity))).toStrictEqual(new Set(["error"]));
  });
});
