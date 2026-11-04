import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { soundProfile } from "../../../scripts/xapi-profile-rules.js";
import { readProfile, validateProfile } from "../src/profiles/index.js";
import { parseJsonPath, selectJsonPath } from "../src/profiles/internal.js";
import { anything, RUNS, returnsOrRefuses } from "./fuzz.js";

/** The strings that a member of a profile may be replaced by: the bad forms of the formats, and the terms of the specification. */
const STRINGS = [
  ...BAD_STRINGS,
  "Profile",
  "Verb",
  "ActivityType",
  "ResultExtension",
  "StatementTemplate",
  "Pattern",
  "included",
  "$.result.score.raw",
  "$..*",
  "$[?(@.id)]",
  "{ }",
  "http://example.org/profiles/sports/v2",
  "http://example.org/profiles/sports/templates/start",
  "http://example.org/profiles/sports/patterns/handoffs",
  "2020-02-20T20:20:20Z",
];

/** The profile of the examples as JSON, which the mutations change. */
const PROFILE = fc.constant(soundProfile());

describe("the reader and the validator of profiles on any value", () => {
  it("answer with findings or a refusal, and throw no other error, for a value of any kind", () => {
    fc.assert(
      fc.property(anything, (value) => {
        if (typeof value !== "string") expect(Array.isArray(validateProfile(value))).toBe(true);
        returnsOrRefuses(() => readProfile(value));
      }),
      RUNS,
    );
  });

  it("give well-formed findings for a profile with two changes, and refuse it exactly when it has an error", () => {
    fc.assert(
      fc.property(PROFILE, mutations, mutations, (profile, first, second) => {
        const changed = mutate(Object(mutate(profile, first, STRINGS)), second, STRINGS);
        const findings = validateProfile(changed);
        for (const finding of findings) {
          expect(finding.rule).toMatch(/^[a-z0-9-]+$/u);
          expect(finding.message.length).toBeGreaterThan(0);
          expect(finding.path === "" || finding.message.startsWith(finding.path)).toBe(false);
        }
        if (findings.some(({ severity }) => severity === "error"))
          expect(() => readProfile(changed)).toThrow(DataError);
        else expect(readProfile(changed)).toStrictEqual(readProfile(JSON.parse(JSON.stringify(changed))));
      }),
      RUNS,
    );
  });
});

describe("the JSONPaths of the rules on any text", () => {
  /** Texts made of the characters that JSONPath gives a meaning to, and of others. */
  const text = fc.string({
    unit: fc.constantFrom(
      "$",
      ".",
      "[",
      "]",
      "*",
      "'",
      '"',
      ",",
      "|",
      " ",
      "?",
      "(",
      ")",
      "-",
      ":",
      "0",
      "1",
      "a",
      "\\",
    ),
  });

  it("read a text as a path or refuse it with DataError, and find values of any value with a path read", () => {
    fc.assert(
      fc.property(fc.oneof(text, fc.string()), fc.jsonValue(), (path, value) => {
        let parsed: ReturnType<typeof parseJsonPath>;
        try {
          parsed = parseJsonPath(path);
        } catch (caught) {
          expect(caught).toBeInstanceOf(DataError);
          return;
        }
        expect(Array.isArray(selectJsonPath(parsed, value))).toBe(true);
      }),
      { ...RUNS, numRuns: 2000 },
    );
  });
});
