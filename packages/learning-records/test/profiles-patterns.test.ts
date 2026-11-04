import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Pattern } from "../src/profiles/index.js";
import { buildPatternGraph, matchPatterns } from "../src/profiles/internal.js";

/** A Pattern as the reference script writes it: a template id, or a kind with its members. */
type Tree = string | readonly [string, Tree | readonly Tree[]];

/** The fixture of `validation/xapi_profile_patterns.py`: Patterns, series and what ADL's `matches` gives for them. */
interface Fixture {
  readonly cases: readonly {
    readonly name: string;
    readonly pattern: Tree;
    readonly series: readonly {
      readonly statements: readonly string[];
      readonly outcome: string;
      readonly remaining: number;
    }[];
  }[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL("./fixtures/xapi-profile-patterns.json", import.meta.url), "utf8"),
);

/**
 * Turns a tree into Patterns, and returns the id of its root. Two subtrees that are the same are one Pattern, as a profile
 * names one Pattern from several, so that what the matching keeps of a Pattern serves each place it has.
 */
function toPatterns(tree: Tree, patterns: Map<string, Pattern>): string {
  if (typeof tree === "string") return tree;
  const [kind, value] = tree;
  const id = `https://example.org/patterns/${encodeURIComponent(JSON.stringify(tree))}`;
  if (patterns.has(id)) return id;
  patterns.set(id, { id, type: "Pattern" });
  const members =
    kind === "sequence" || kind === "alternates"
      ? (value as readonly Tree[]).map((member) => toPatterns(member, patterns))
      : toPatterns(value as Tree, patterns);
  patterns.set(id, { id, type: "Pattern", [kind]: members });
  return id;
}

/** Matches a series of single templates against a tree, as the validator matches a primary Pattern. */
function matchTree(tree: Tree, statements: readonly string[]): { outcome: string; remaining: number } {
  const patterns = new Map<string, Pattern>();
  const root = toPatterns(tree, patterns);
  const graph = buildPatternGraph(
    [root],
    (id) => patterns.get(id),
    (id) => !patterns.has(id),
  );
  const [result] = matchPatterns(
    graph,
    statements.map((id) => new Set([id])),
  );
  return { outcome: result?.outcome ?? "none", remaining: result?.remaining ?? -1 };
}

/** Draws a tree with distinct template ids, as the strategies of ADL's file do, and a series that follows it. */
const followedTree: fc.Arbitrary<{ tree: Tree; statements: string[] }> = fc
  .letrec<{ node: { tree: Tree; statements: string[] } }>((tie) => ({
    node: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      fc.uuid().map((id) => ({ tree: id, statements: [id] })),
      fc.array(tie("node"), { minLength: 2, maxLength: 3 }).map((members) => ({
        tree: ["sequence", members.map((member) => member.tree)] as const,
        statements: members.flatMap((member) => member.statements),
      })),
      fc
        .tuple(fc.constantFrom("zeroOrMore", "oneOrMore", "optional"), tie("node"), fc.nat(2))
        .map(([kind, member, extra]) => ({
          tree: [kind, member.tree] as const,
          statements: Array.from(
            { length: kind === "optional" ? Math.min(extra, 1) : kind === "oneOrMore" ? extra + 1 : extra },
            () => member.statements,
          ).flat(),
        })),
    ),
  }))
  .node.filter(({ tree }) => typeof tree !== "string");

describe("matching Statements against Patterns", () => {
  it("gives what ADL's reference implementation of the algorithm gives for every series of the fixture", () => {
    let series = 0;
    for (const { name, pattern, series: cases } of fixture.cases) {
      for (const { statements, outcome, remaining } of cases) {
        expect(matchTree(pattern, statements), `${name}: ${statements.join(" ")}`).toEqual({ outcome, remaining });
        series += 1;
      }
    }
    expect(series).toBeGreaterThan(2000);
  });

  it("matches every series that a Pattern of distinct templates draws, as ADL's property test asks", () => {
    fc.assert(
      fc.property(followedTree, ({ tree, statements }) => {
        expect(matchTree(tree, statements)).toEqual({ outcome: "success", remaining: 0 });
      }),
      { seed: 9274, numRuns: 300 },
    );
  });

  it("gives a partial match for Statements that end in the middle of a Pattern", () => {
    expect(matchTree(["sequence", ["a", "b", "c"]], ["a", "b"])).toEqual({ outcome: "partial", remaining: 0 });
    expect(matchTree(["oneOrMore", ["sequence", ["a", "b"]]], ["a", "b", "a"])).toEqual({
      outcome: "partial",
      remaining: 1,
    });
  });
});
