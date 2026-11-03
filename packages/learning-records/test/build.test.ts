import { createHash } from "node:crypto";
import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import {
  buildStatement,
  deriveStatementId,
  mboxSha1sum,
  readStatement,
  type StatementInput,
  validateStatement,
  voidingStatement,
} from "../src/index.js";
import { copyOf, sharesNothing, summary } from "./fixture.js";
import { providerStatement, uuid } from "./full-statement.js";

/** The input of a builder: the Statement of a provider with the time in another zone. */
function input(): StatementInput {
  const { id = "", actor, verb, object, result, context, attachments } = providerStatement();
  return { id, actor, verb, object, timestamp: "2024-06-13T20:46:03.25+02:00", result, context, attachments };
}

describe("buildStatement", () => {
  it("builds the Statement of an event: a copy, the time in UTC with milliseconds, and the version", () => {
    const statement = buildStatement(input());
    expect(statement).toStrictEqual({
      ...providerStatement(),
      timestamp: "2024-06-13T18:46:03.250Z",
      version: "2.0.0",
    });
    expect(sharesNothing(statement, input())).toBe(true);
  });

  it("builds a Statement that a reader of either role reads again as itself", () => {
    const statement = buildStatement(input());
    expect(readStatement(statement)).toStrictEqual(statement);
    expect(readStatement(statement, { role: "provider" })).toStrictEqual(statement);
    expect(summary(validateStatement(statement, { role: "provider" }))).toStrictEqual([
      { path: "version", rule: "lrs-managed-property", severity: "warning" },
    ]);
  });

  it("builds from the smallest input, and from an input that is frozen", () => {
    const minimal = deepFreeze({
      id: uuid(7),
      actor: { mbox: "mailto:a@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
      object: { id: "https://example.org/a" },
      timestamp: "2024-06-13T18:46:03Z",
    });
    expect(buildStatement(minimal)).toStrictEqual({
      ...minimal,
      timestamp: "2024-06-13T18:46:03.000Z",
      version: "2.0.0",
    });
  });

  it("builds a Statement about a Statement, with the time of the SubStatement as it is given", () => {
    const sub = {
      objectType: "SubStatement" as const,
      actor: { mbox: "mailto:b@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
      object: { id: "https://example.org/q" },
      timestamp: "2024-06-13T18:00:00.000Z",
    };
    const { revision: _revision, platform: _platform, ...context } = input().context ?? {};
    expect(buildStatement({ ...input(), context, object: sub }).object).toStrictEqual(sub);
  });

  it("names every error, each with its path, and not only the first", () => {
    const bad = { ...input(), actor: { mbox: "learner@example.org" }, verb: { id: "completed" } };
    expect(() => buildStatement(bad)).toThrow(DataError);
    expect(() => buildStatement(bad)).toThrow(
      /^The statement is invalid\. At actor\.mbox: expected a mailto IRI .* At verb\.id: expected a URI with a scheme/s,
    );
  });

  it("refuses an input with no id, since a resend repeats the id", () => {
    const { id: _id, ...withoutId } = input();
    expect(() => buildStatement(withoutId as StatementInput)).toThrow(
      'The statement is invalid. At id: missing the property "id", which a built Statement needs so that a resend repeats it.',
    );
  });

  it("refuses an input with no timestamp, since the time is that of the event and not that of the LRS", () => {
    const { timestamp: _timestamp, ...withoutTime } = input();
    expect(() => buildStatement(withoutTime as StatementInput)).toThrow(
      'The statement is invalid. At timestamp: missing the property "timestamp", which a built Statement needs so that it holds the time of the event and not the time that an LRS stored it.',
    );
    const { id: _id, ...withNeither } = withoutTime;
    expect(() => buildStatement(withNeither as StatementInput)).toThrow(/At id: missing .* At timestamp: missing/su);
  });

  it.each([
    ["a time that is not a time", { timestamp: "yesterday" }, "At timestamp: expected a date and time as RFC 3339"],
    [
      "a time with no offset",
      { timestamp: "2024-06-13T18:46:03" },
      "At timestamp: expected a date and time as RFC 3339",
    ],
    ["a time that is not a string", { timestamp: 5 }, "At timestamp: expected a string, found 5"],
    ["an id that is not a UUID", { id: "x" }, 'At id: expected a UUID as 8-4-4-4-12 hexadecimal digits, found "x"'],
    [
      "a score above 1",
      { result: { score: { scaled: 2 } } },
      "At result.score.scaled: expected a number from -1 to 1, found 2",
    ],
  ])("refuses %s", (_name, change, sentence) => {
    expect(() => buildStatement({ ...input(), ...change } as StatementInput)).toThrow(sentence);
  });

  it.each(["stored", "authority", "version"])(
    "refuses %s, which the LRS sets and a Statement is not built from",
    (name) => {
      const given = { ...input(), [name]: name === "version" ? "2.0.0" : "x" };
      expect(() => buildStatement(given as unknown as StatementInput)).toThrow(
        new RegExp(`^A statement input has the properties .*, found "${name}"\\.$`),
      );
    },
  );

  it.each([null, undefined, 5, "x", []])("refuses %j, which is not an input", (value) => {
    expect(() => buildStatement(value as never)).toThrow(DataError);
    expect(() => buildStatement(value as never)).toThrow(/^A statement input must be an object, found /);
  });

  it("writes the time of any instant in UTC, and reads it as the same instant", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), fc.integer({ min: -14, max: 14 }), (at, hours) => {
        const offset = `${hours < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(2, "0")}:00`;
        const local = new Date(at + hours * 3_600_000).toISOString().replace(/Z$/u, offset);
        expect(buildStatement({ ...input(), timestamp: local }).timestamp).toBe(new Date(at).toISOString());
      }),
      { seed: 20_241_102, numRuns: 200 },
    );
  });
});

describe("voidingStatement", () => {
  const voiding = {
    id: uuid(8),
    actor: { mbox: "mailto:teacher@example.org" },
    timestamp: "2024-06-13T20:46:03+02:00",
  };

  it("builds the Statement with the voided verb and a reference to the target", () => {
    expect(voidingStatement(uuid(1), voiding)).toStrictEqual({
      id: uuid(8),
      actor: { mbox: "mailto:teacher@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/voided", display: { "en-US": "voided" } },
      object: { objectType: "StatementRef", id: uuid(1) },
      timestamp: "2024-06-13T18:46:03.000Z",
      version: "2.0.0",
    });
  });

  it("builds a Statement that a reader accepts, whose target need not exist", () => {
    const statement = voidingStatement(uuid(404), voiding);
    expect(readStatement(statement, { role: "provider" })).toStrictEqual(statement);
  });

  it.each([
    ["x", 'The target must be the id of the Statement to void, as a UUID, found "x".'],
    ["", 'The target must be the id of the Statement to void, as a UUID, found "".'],
    [5, "The target must be a string, found 5."],
    [null, "The target must be a string, found null."],
  ])("refuses the target %j", (target, sentence) => {
    expect(() => voidingStatement(target as string, voiding)).toThrow(new DataError(sentence));
  });

  it("refuses an input that is not one, or that has a property it does not take", () => {
    expect(() => voidingStatement(uuid(1), null as never)).toThrow(
      /^The voiding input must be an object, found null\.$/,
    );
    expect(() => voidingStatement(uuid(1), { ...voiding, verb: { id: "x" } } as never)).toThrow(
      /^The voiding input has the properties "id", "actor" and "timestamp", found "verb"\.$/,
    );
  });

  it("refuses an input whose Statement cannot be built, as buildStatement does", () => {
    expect(() => voidingStatement(uuid(1), { ...voiding, timestamp: "x" })).toThrow("At timestamp:");
  });
});

describe("deriveStatementId", () => {
  const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

  /** UUID version 5 as RFC 9562 5.5 writes it: SHA-1 of the namespace and the name, with the version and variant bits set. */
  function version5(namespace: string, name: string): string {
    const hash = createHash("sha1")
      .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
      .update(name, "utf8")
      .digest()
      .subarray(0, 16);
    hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
    hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
    const hex = hash.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  it("gives the UUID of version 5 that RFC 9562 gives for the name www.example.com in the DNS namespace", () => {
    expect(deriveStatementId(NAMESPACE, "www.example.com")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("gives what an independent computation of version 5 gives, for any name and any namespace", () => {
    fc.assert(
      fc.property(fc.uuid(), fc.string({ minLength: 1 }), (namespace, name) => {
        expect(deriveStatementId(namespace, name)).toBe(version5(namespace, name));
      }),
      { seed: 20_241_102, numRuns: 200 },
    );
  });

  it("gives one id for one event, and another for another, so that a resend repeats the id", () => {
    const first = deriveStatementId(uuid(1), "learner-1/course-1/attempt-1");
    expect(deriveStatementId(uuid(1), "learner-1/course-1/attempt-1")).toBe(first);
    expect(deriveStatementId(uuid(1), "learner-1/course-1/attempt-2")).not.toBe(first);
    expect(deriveStatementId(uuid(2), "learner-1/course-1/attempt-1")).not.toBe(first);
    expect(deriveStatementId(uuid(1).toUpperCase(), "learner-1/course-1/attempt-1")).toBe(first);
  });

  it("gives an id that a Statement accepts", () => {
    expect(readStatement({ ...providerStatement(), id: deriveStatementId(uuid(1), "x") }).id).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it.each([
    ["x", "a", 'The namespace must be a UUID, found "x".'],
    ["", "a", 'The namespace must be a UUID, found "".'],
    [5, "a", "The namespace must be a string, found 5."],
    [uuid(1), "", 'The name must be a non-empty string, found "".'],
    [uuid(1), 5, "The name must be a non-empty string, found 5."],
    [uuid(1), null, "The name must be a non-empty string, found null."],
  ])("refuses the namespace %j and the name %j", (namespace, name, sentence) => {
    expect(() => deriveStatementId(namespace as string, name as string)).toThrow(new DataError(sentence));
  });
});

describe("mboxSha1sum", () => {
  it("gives the SHA-1 of the IRI as 40 hexadecimal digits in lower case, as Node computes it", () => {
    for (const mailto of ["mailto:learner@example.org", "mailto:A.B+c@Example.ORG", "mailto:x@y"]) {
      expect(mboxSha1sum(mailto)).toBe(createHash("sha1").update(mailto, "utf8").digest("hex"));
    }
    expect(mboxSha1sum("mailto:learner@example.org")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("hashes the IRI as it is written, so that a change of case is another hash", () => {
    expect(mboxSha1sum("mailto:a@example.org")).not.toBe(mboxSha1sum("mailto:A@example.org"));
  });

  it("gives an identifier that an Agent accepts", () => {
    const statement = readStatement({
      ...providerStatement(),
      actor: { mbox_sha1sum: mboxSha1sum("mailto:a@example.org") },
    });
    expect(statement.actor.mbox_sha1sum).toHaveLength(40);
  });

  it.each(["learner@example.org", "mailto:", "mailto:a@b,c@d", "", "MAILTO:a@b", 5, null])(
    "refuses %j, which is not a mailto IRI with one address",
    (value) => {
      expect(() => mboxSha1sum(value as string)).toThrow(DataError);
      expect(() => mboxSha1sum(value as string)).toThrow(/^The mailto IRI must be /);
    },
  );
});

describe("the builders on input of any kind", () => {
  it("do not change their input, and share nothing with it", () => {
    const given = deepFreeze(copyOf(input()));
    expect(sharesNothing(buildStatement(given), given)).toBe(true);
  });
});
