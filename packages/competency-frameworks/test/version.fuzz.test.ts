import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { convertCaseVersion, ENTITY_KINDS } from "../src/index.js";
import { fullEntities, fullPackage } from "./full-package.js";
import { anything, convertsOrRefuses, RUNS, returnsOrRefuses } from "./fuzz.js";

describe("the conversion on any value", () => {
  it("answers or throws a DataError, and never throws another error", () => {
    fc.assert(
      fc.property(anything, (value) => {
        returnsOrRefuses(() => {
          const result = convertCaseVersion(value as never, "1.0");
          expect(Array.isArray(result.dropped)).toBe(true);
        });
      }),
      RUNS,
    );
  });

  it("converts the full package with a change, or throws a DataError", () => {
    convertsOrRefuses(fc.constant(JSON.parse(JSON.stringify(fullPackage()))));
  });

  it.each(ENTITY_KINDS)("converts the full %s with a change, or throws a DataError", (kind) => {
    convertsOrRefuses(fc.constant(JSON.parse(JSON.stringify(fullEntities()[kind]))));
  });
});
