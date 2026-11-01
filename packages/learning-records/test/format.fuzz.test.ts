import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mutate, mutations } from "../../../scripts/json-mutation.js";
import { formatStatement, readStatement, STATEMENT_FORMATS, type Statement } from "../src/index.js";
import { fullStatement } from "./full-statement.js";
import { anything, RUNS, returnsOrRefuses, STRINGS } from "./fuzz.js";

describe("formatStatement on any value", () => {
  it("returns a Statement or refuses with a DataError, for a value of any kind", () => {
    fc.assert(
      fc.property(anything, anything, anything, (statement, format, options) => {
        returnsOrRefuses(() => formatStatement(statement as Statement, format as never, options as never));
      }),
      RUNS,
    );
  });

  it("returns a Statement that a reader accepts, and that formatting again does not change", () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATEMENT_FORMATS), mutations, (format, mutation) => {
        const statement = mutate(JSON.parse(JSON.stringify(fullStatement())), mutation, STRINGS) as Statement;
        returnsOrRefuses(() => {
          const once = formatStatement(statement, format);
          expect(readStatement(once, { role: "lrs" })).toStrictEqual(once);
          expect(formatStatement(once, format)).toStrictEqual(once);
        });
      }),
      RUNS,
    );
  });
});
