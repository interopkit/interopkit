import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { ENTITY_KINDS, toCaseVersion } from "../src/index.js";
import { officialArbitrary } from "./official.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_103, numRuns: 300 };

/** Values of every kind that JSON or JavaScript can hand over, including those that JSON cannot write. */
const anything = fc.oneof(
  fc.jsonValue(),
  fc.anything({ withNullPrototype: true, withBigInt: true, withDate: true, withMap: true, withSet: true }),
);

/** Tells whether a function returns, or throws the error of the family, and nothing else. */
function returnsOrRefuses(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
  }
}

describe("the conversion on any value", () => {
  it("answers or throws a DataError, and never throws another error", () => {
    fc.assert(
      fc.property(anything, (value) => {
        returnsOrRefuses(() => {
          const result = toCaseVersion(value as never, "1.0");
          expect(Array.isArray(result.dropped)).toBe(true);
        });
      }),
      RUNS,
    );
  });

  it.each(["package", ...ENTITY_KINDS] as const)("converts %s with a change, or throws a DataError", (kind) => {
    fc.assert(
      fc.property(officialArbitrary("1.1", kind, "1.1"), mutations, (value, mutation) => {
        returnsOrRefuses(() => toCaseVersion(mutate(value, mutation, BAD_STRINGS) as never, "1.0"));
      }),
      { ...RUNS, numRuns: 100 },
    );
  });
});
