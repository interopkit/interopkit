import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { ENTITY_KINDS, readEntity, readPackage, validateEntity, validatePackage } from "../src/index.js";
import { minimalPackage } from "./fixture.js";
import { officialArbitrary } from "./official.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_102, numRuns: 300 };
const STRINGS = [...BAD_STRINGS, "isChildOf", "isTranslationOf", "CASE", "ext:video"];
const VERSIONS = fc.constantFrom("1.0", "1.1");

/** Values of every kind that JSON or JavaScript can hand over, including those that JSON cannot write. */
const anything = fc.oneof(
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
function returnsOrRefuses(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
  }
}

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
    fc.assert(
      fc.property(officialArbitrary("1.1", "package"), mutations, mutations, (pkg, first, second) => {
        const changed = mutate(Object(mutate(pkg, first, STRINGS)), second, STRINGS);
        for (const finding of validatePackage(changed)) {
          expect(finding.path).toBeTypeOf("string");
          expect(finding.rule).toMatch(/^[a-z0-9-]+$/u);
          expect(finding.message.length).toBeGreaterThan(0);
          expect(finding.path === "" || finding.message.startsWith(finding.path)).toBe(false);
        }
      }),
      RUNS,
    );
  });

  it("refuse a package exactly when it has an error, and then name the first error", () => {
    fc.assert(
      fc.property(officialArbitrary("1.1", "package"), mutations, (pkg, mutation) => {
        const changed = mutate(pkg, mutation, STRINGS);
        const errors = validatePackage(changed).filter(({ severity }) => severity === "error");
        if (errors.length === 0) {
          expect(() => readPackage(changed)).not.toThrow();
          return;
        }
        expect(() => readPackage(changed)).toThrow(DataError);
        expect(() => readPackage(changed)).toThrow(`The package is invalid${errors[0]?.path === "" ? "" : " at "}`);
      }),
      RUNS,
    );
  });

  it("stop a hostile depth of the extensions at the limit with a finding, whatever the depth is", () => {
    let deep: Record<string, unknown> = {};
    for (let level = 0; level < 200_000; level += 1) deep = { n: deep };
    const issues = validatePackage({ ...minimalPackage(), extensions: deep });
    expect(issues.map(({ path, rule }) => ({ path, rule }))).toStrictEqual([
      { path: "extensions", rule: "invalid-value" },
    ]);
  });
});

describe.each(["1.0", "1.1"] as const)("a package of CASE %s that is read", (version) => {
  it("is read again as itself, and judged as it was: what is returned is what was read", () => {
    fc.assert(
      fc.property(officialArbitrary(version, "package"), (generated) => {
        // The text of JSON is what a host reads, and it has no negative zero.
        const pkg = JSON.parse(JSON.stringify(generated));
        const issues = validatePackage(pkg, { version });
        if (issues.some(({ severity }) => severity === "error")) {
          expect(() => readPackage(pkg, { version })).toThrow(DataError);
          return;
        }
        const first = readPackage(pkg, { version });
        expect(first).toStrictEqual(pkg);
        expect(readPackage(first, { version })).toStrictEqual(first);
        expect(validatePackage(first, { version })).toStrictEqual(issues);
      }),
      RUNS,
    );
  });
});
