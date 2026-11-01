import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { expect } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { type RuleRole, readStatement, validateStatement } from "../src/index.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
export const RUNS = { seed: 20_241_102, numRuns: 300 };

/** The roles that a reader is told. */
export const ROLES = fc.constantFrom<RuleRole>("lrs", "provider");

/** The strings that a member may be replaced by: the bad forms of the formats, and the terms of the vocabularies. */
const STRINGS = [
  ...BAD_STRINGS,
  "Agent",
  "Group",
  "SubStatement",
  "StatementRef",
  "choice",
  "http://adlnet.gov/expapi/verbs/voided",
  "mailto:a@example.org",
  "en_US",
  "PT1H",
  "P0001-00-00T00:00:00",
  "2024-06-13T18:46:03.250+02:00",
];

/** Values of every kind that JSON or JavaScript can hand over, including those that JSON cannot write. */
export const anything = fc.oneof(
  fc.jsonValue(),
  fc.anything({
    withNullPrototype: true,
    withBigInt: true,
    withDate: true,
    withMap: true,
    withSet: true,
    withTypedArray: true,
  }),
);

/** Tells whether a function returns, or throws the error of the family, and nothing else. */
export function returnsOrRefuses(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
  }
}

/** Checks that the findings of a Statement with two changes have a path, a kebab-case rule and a sentence that is not the path's. */
export function findingsAreWellFormed(statements: fc.Arbitrary<Record<string, unknown>>, role: RuleRole): void {
  fc.assert(
    fc.property(statements, mutations, mutations, (statement, first, second) => {
      const changed = mutate(Object(mutate(statement, first, STRINGS)), second, STRINGS);
      for (const finding of validateStatement(changed, { role })) {
        expect(finding.path).toBeTypeOf("string");
        expect(finding.rule).toMatch(/^[a-z0-9-]+$/u);
        expect(finding.message.length).toBeGreaterThan(0);
        expect(finding.path === "" || finding.message.startsWith(finding.path)).toBe(false);
        expect(["error", "warning"]).toContain(finding.severity);
      }
    }),
    RUNS,
  );
}

/** Checks that a Statement with a change is refused exactly when the validator finds an error, and that the refusal names it. */
export function refusesExactlyOnError(statements: fc.Arbitrary<Record<string, unknown>>, role: RuleRole): void {
  fc.assert(
    fc.property(statements, mutations, (statement, mutation) => {
      const changed = mutate(statement, mutation, STRINGS);
      const errors = validateStatement(changed, { role }).filter(({ severity }) => severity === "error");
      if (errors.length === 0) {
        expect(() => readStatement(changed, { role })).not.toThrow();
        return;
      }
      expect(() => readStatement(changed, { role })).toThrow(DataError);
      expect(() => readStatement(changed, { role })).toThrow(
        `The statement is invalid${errors[0]?.path === "" ? "" : " at "}`,
      );
    }),
    RUNS,
  );
}

/** Checks that a Statement that is read is read again as itself, and judged by the same errors. */
export function readsAgainAsItself(statements: fc.Arbitrary<Record<string, unknown>>, role: RuleRole): void {
  fc.assert(
    fc.property(statements, mutations, (generated, mutation) => {
      // The text of JSON is what a host reads, and it has no negative zero.
      const statement = JSON.parse(JSON.stringify(mutate(generated, mutation, STRINGS)));
      const errors = validateStatement(statement, { role }).filter(({ severity }) => severity === "error");
      if (errors.length > 0) {
        expect(() => readStatement(statement, { role })).toThrow(DataError);
        return;
      }
      const first = readStatement(statement, { role });
      expect(readStatement(first, { role })).toStrictEqual(first);
      expect(validateStatement(first, { role }).filter(({ severity }) => severity === "error")).toStrictEqual([]);
    }),
    RUNS,
  );
}
