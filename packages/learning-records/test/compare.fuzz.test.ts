import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mutate, mutations } from "../../../scripts/json-mutation.js";
import { isSameStatement, type Statement } from "../src/index.js";
import { fullStatement } from "./full-statement.js";
import { anything, RUNS, returnsOrRefuses, STRINGS } from "./fuzz.js";

describe("isSameStatement on any value", () => {
  it("answers or refuses with a DataError, for a value of any kind", () => {
    fc.assert(
      fc.property(anything, anything, (a, b) => {
        returnsOrRefuses(() => isSameStatement(a as Statement, b as Statement));
      }),
      RUNS,
    );
  });

  it("holds a Statement to be the same as a copy of itself that has the properties in another order", () => {
    fc.assert(
      fc.property(mutations, (mutation) => {
        const statement = mutate(JSON.parse(JSON.stringify(fullStatement())), mutation, STRINGS) as Statement;
        const reversed = Object.fromEntries(Object.entries(statement).reverse()) as unknown as Statement;
        returnsOrRefuses(() => expect(isSameStatement(statement, reversed)).toBe(true));
      }),
      RUNS,
    );
  });
});
