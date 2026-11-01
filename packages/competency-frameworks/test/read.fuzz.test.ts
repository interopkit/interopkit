import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ENTITY_KINDS, readEntity, readPackage, validateEntity, validatePackage } from "../src/index.js";
import { minimalPackage } from "./fixture.js";
import { fullPackage } from "./full-package.js";
import {
  anything,
  findingsAreWellFormed,
  RUNS,
  readsAgainAsItself,
  refusesExactlyOnError,
  returnsOrRefuses,
  VERSIONS,
} from "./fuzz.js";

/** The full package of the tests, which the mutations of the properties change; no download is read. */
const FULL = fc.constant(fullPackage()).map((pkg) => JSON.parse(JSON.stringify(pkg)));

describe("the readers and the validators on any value", () => {
  it("answer with findings or a refusal, and throw no other error, for a value of any kind", () => {
    fc.assert(
      fc.property(anything, VERSIONS, (value, version) => {
        expect(Array.isArray(validatePackage(value, { version }))).toBe(true);
        returnsOrRefuses(() => readPackage(value, { version }));
        for (const kind of ENTITY_KINDS) {
          expect(Array.isArray(validateEntity(kind, value, { version }))).toBe(true);
          returnsOrRefuses(() => readEntity(kind, value, { version }));
        }
      }),
      RUNS,
    );
  });

  it("give findings with a path, a kebab-case rule and a sentence that does not start with the path", () => {
    findingsAreWellFormed(FULL);
  });

  it("refuse the full package with a change exactly when it has an error, and then name the first error", () => {
    refusesExactlyOnError(FULL);
  });

  it("stop a hostile depth of the extensions at the limit with a finding, whatever the depth is", () => {
    let deep: Record<string, unknown> = {};
    for (let level = 0; level < 200_000; level += 1) deep = { n: deep };
    const issues = validatePackage({ ...minimalPackage(), extensions: deep });
    expect(issues.map(({ path, rule }) => ({ path, rule }))).toStrictEqual([
      { path: "extensions", rule: "invalid-value" },
    ]);
  });

  it("read the full package again as itself, and judge it as it was", () => {
    readsAgainAsItself("1.1", FULL);
  });
});
