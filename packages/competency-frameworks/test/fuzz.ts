import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { expect } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { type CaseVersion, convertCaseVersion, readPackage, validatePackage } from "../src/index.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
export const RUNS = { seed: 20_241_102, numRuns: 300 };

/** The strings that a member may be replaced by: the bad forms of the formats, and the terms of the vocabularies. */
const STRINGS = [...BAD_STRINGS, "isChildOf", "isTranslationOf", "CASE", "ext:video"];

/** The versions that a reader is told. */
export const VERSIONS = fc.constantFrom<CaseVersion>("1.0", "1.1");

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

/** Checks that the findings of a package with two changes have a path, a kebab-case rule and a sentence that is not the path's. */
export function findingsAreWellFormed(packages: fc.Arbitrary<Record<string, unknown>>): void {
  fc.assert(
    fc.property(packages, mutations, mutations, (pkg, first, second) => {
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
}

/** Checks that a package with a change is refused exactly when the validator finds an error, and that the refusal names it. */
export function refusesExactlyOnError(packages: fc.Arbitrary<Record<string, unknown>>): void {
  fc.assert(
    fc.property(packages, mutations, (pkg, mutation) => {
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
}

/** Checks that a package of a version that is read is read again as itself, and judged as it was. */
export function readsAgainAsItself(version: CaseVersion, packages: fc.Arbitrary<Record<string, unknown>>): void {
  fc.assert(
    fc.property(packages, (generated) => {
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
}

/** Checks that a value of CASE 1.1 with a change is converted, or refused with a `DataError`, and nothing else. */
export function convertsOrRefuses(values: fc.Arbitrary<Record<string, unknown>>): void {
  fc.assert(
    fc.property(values, mutations, (value, mutation) => {
      returnsOrRefuses(() => convertCaseVersion(mutate(value, mutation, BAD_STRINGS) as never, "1.0"));
    }),
    { ...RUNS, numRuns: 100 },
  );
}
