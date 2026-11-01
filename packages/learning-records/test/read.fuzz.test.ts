import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readStatement, validateStatement, validateStatements } from "../src/index.js";
import { fullStatement, providerStatement, subStatementStatement } from "./full-statement.js";
import {
  anything,
  findingsAreWellFormed,
  ROLES,
  RUNS,
  readsAgainAsItself,
  refusesExactlyOnError,
  returnsOrRefuses,
} from "./fuzz.js";

/** The Statements of the tests as JSON, which the mutations of the properties change; no download is read. */
const STATEMENTS = fc
  .constantFrom(fullStatement(), providerStatement(), subStatementStatement())
  .map((statement) => JSON.parse(JSON.stringify(statement)));

describe("the readers and the validators on any value", () => {
  it("answer with findings or a refusal, and throw no other error, for a value of any kind", () => {
    fc.assert(
      fc.property(anything, ROLES, (value, role) => {
        const findings = validateStatement(value, { role });
        expect(Array.isArray(findings)).toBe(true);
        expect(Array.isArray(validateStatements(value, { role }))).toBe(true);
        returnsOrRefuses(() => readStatement(value, { role }));
      }),
      RUNS,
    );
  });

  it("give findings with a path, a kebab-case rule, a sentence that does not start with the path, and a severity", () => {
    for (const role of ["lrs", "provider"] as const) findingsAreWellFormed(STATEMENTS, role);
  });

  it("refuse a Statement with a change exactly when it has an error, and then name the first error", () => {
    for (const role of ["lrs", "provider"] as const) refusesExactlyOnError(STATEMENTS, role);
  });

  it("read a Statement that is read again as itself, and find no error in it", () => {
    for (const role of ["lrs", "provider"] as const) readsAgainAsItself(STATEMENTS, role);
  });

  it("stop a hostile depth of the extensions at the limit with a finding, whatever the depth is", () => {
    let deep: Record<string, unknown> = {};
    for (let level = 0; level < 200_000; level += 1) deep = { n: deep };
    const statement = { ...providerStatement(), result: { extensions: { "https://example.org/x": deep } } };
    expect(validateStatement(statement).map(({ path, rule }) => ({ path, rule }))).toStrictEqual([
      { path: "result.extensions", rule: "invalid-value" },
    ]);
  });

  it("judge a batch of any values as one finding for each entry that is not a Statement", () => {
    fc.assert(
      fc.property(fc.array(anything, { maxLength: 8 }), (values) => {
        expect(validateStatements(values).length).toBeGreaterThanOrEqual(
          values.filter((value) => typeof value !== "object" || value === null).length,
        );
      }),
      RUNS,
    );
  });
});
