import { describe, it } from "vitest";
import { findingsAreWellFormed, readsAgainAsItself, refusesExactlyOnError } from "./fuzz.js";
import { officialArbitrary } from "./official.js";

describe("the readers and the validators on the values that the official schemas describe", () => {
  it("give findings with a path, a kebab-case rule and a sentence that does not start with the path", () => {
    findingsAreWellFormed(officialArbitrary("1.1", "package"));
  });

  it("refuse a package exactly when it has an error, and then name the first error", () => {
    refusesExactlyOnError(officialArbitrary("1.1", "package"));
  });
});

describe.each(["1.0", "1.1"] as const)("a package of CASE %s that is read", (version) => {
  it("is read again as itself, and judged as it was: what is returned is what was read", () => {
    readsAgainAsItself(version, officialArbitrary(version, "package"));
  });
});
