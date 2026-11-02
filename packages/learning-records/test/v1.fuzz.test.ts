import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readStatement, validateStatement, validateStatements } from "../src/index.js";
import { providerStatementV1, subStatementStatement } from "./full-statement.js";
import {
  anything,
  findingsAreWellFormed,
  ROLES,
  RUNS,
  readsAgainAsItself,
  refusesExactlyOnError,
  returnsOrRefuses,
} from "./fuzz.js";

const VERSION = "1.0.3";

/** The Statements of 1.0.3 of the tests as JSON, which the mutations of the properties change. */
const STATEMENTS = fc
  .constantFrom(providerStatementV1(), subStatementStatement())
  .map((statement) => JSON.parse(JSON.stringify(statement)));

/** Text that is nearly a Timestamp of ISO 8601: the parts of one, in any order, with the separators that a form may use. */
const NEAR_TIMES = fc
  .array(
    fc.constantFrom(
      "2024",
      "06",
      "13",
      "20240613",
      "-",
      ":",
      "T",
      "t",
      " ",
      "18",
      "46",
      "03",
      ".250",
      "Z",
      "z",
      "+02",
      "-00",
      "+0200",
      "-00:00",
    ),
    { maxLength: 10 },
  )
  .map((parts) => parts.join(""));

describe("the readers and the validators of 1.0.3 on any value", () => {
  it("answer with findings or a refusal, and throw no other error, for a value of any kind", () => {
    fc.assert(
      fc.property(anything, ROLES, (value, role) => {
        const options = { role, version: VERSION } as const;
        expect(Array.isArray(validateStatement(value, options))).toBe(true);
        expect(Array.isArray(validateStatements(value, options))).toBe(true);
        returnsOrRefuses(() => readStatement(value, options));
      }),
      RUNS,
    );
  });

  it("give findings with a path, a kebab-case rule, a sentence that does not start with the path, and a severity", () => {
    for (const role of ["lrs", "provider"] as const) findingsAreWellFormed(STATEMENTS, { role, version: VERSION });
  });

  it("refuse a Statement with a change exactly when it has an error, and then name the first error", () => {
    for (const role of ["lrs", "provider"] as const) refusesExactlyOnError(STATEMENTS, { role, version: VERSION });
  });

  it("read a Statement that is read again as itself, and find no error in it", () => {
    for (const role of ["lrs", "provider"] as const) readsAgainAsItself(STATEMENTS, { role, version: VERSION });
  });

  it("take a Timestamp only when it is a time, whatever the text, and keep it as it came", () => {
    fc.assert(
      fc.property(NEAR_TIMES, (timestamp) => {
        const statement = { ...providerStatementV1(), attachments: [], timestamp };
        const errors = validateStatement(statement, { version: VERSION }).filter(
          ({ severity }) => severity === "error",
        );
        if (errors.length === 0) {
          expect(readStatement(statement, { version: VERSION }).timestamp).toBe(timestamp);
        } else {
          expect(errors.map(({ path, rule }) => ({ path, rule }))).toStrictEqual([
            { path: "timestamp", rule: "invalid-format" },
          ]);
        }
      }),
      RUNS,
    );
  });
});
