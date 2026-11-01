import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { ENTITY_KINDS, readCredential, readEntity, validateCredential, validateEntity } from "../src/index.js";
import { achievementCredential, clrCredential, endorsementCredential } from "./fixtures.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_103, numRuns: 300 };

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

/** The credentials of the tests, which the mutations change. */
const CREDENTIALS = fc.constantFrom(achievementCredential, endorsementCredential, clrCredential).map((make) => make());

/** The strings that a member may be replaced by: the bad forms of the formats, and the terms that a reader tells apart. */
const STRINGS = [...BAD_STRINGS, "ext:term", "Profile", "VerifiableCredential", "sha256$abc"];

/** Tells whether every object in a value has the plain prototype, so that no member of the input became a prototype. */
function hasPlainPrototypes(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === Array.prototype) && Object.values(value).every(hasPlainPrototypes)
  );
}

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
      fc.property(anything, (value) => {
        expect(Array.isArray(validateCredential(value))).toBe(true);
        returnsOrRefuses(() => readCredential(value));
        for (const kind of ENTITY_KINDS) {
          expect(Array.isArray(validateEntity(kind, value))).toBe(true);
          returnsOrRefuses(() => readEntity(kind, value));
        }
      }),
      RUNS,
    );
  });

  it("give findings with a path, a kebab-case rule and a sentence that does not start with the path", () => {
    fc.assert(
      fc.property(CREDENTIALS, mutations, mutations, (credential, first, second) => {
        const changed = mutate(Object(mutate(credential, first, STRINGS)), second, STRINGS);
        for (const finding of validateCredential(changed)) {
          expect(finding.path).toBeTypeOf("string");
          expect(finding.rule).toMatch(/^[a-z0-9-]+$/u);
          expect(finding.message.length).toBeGreaterThan(0);
          expect(finding.path === "" || finding.message.startsWith(finding.path)).toBe(false);
        }
      }),
      RUNS,
    );
  });

  it("refuse a credential with a change exactly when it has an error, and then name the first error", () => {
    fc.assert(
      fc.property(CREDENTIALS, mutations, (credential, change) => {
        const changed = mutate(credential, change, STRINGS);
        const errors = validateCredential(changed).filter(({ severity }) => severity === "error");
        if (errors.length === 0) {
          expect(() => readCredential(changed)).not.toThrow();
          return;
        }
        expect(() => readCredential(changed)).toThrow(DataError);
        expect(() => readCredential(changed)).toThrow(
          `The credential is invalid${errors[0]?.path === "" ? "" : " at "}`,
        );
      }),
      RUNS,
    );
  });

  it("read a credential again as itself, and judge it as it was", () => {
    fc.assert(
      fc.property(CREDENTIALS, (credential) => {
        const first = readCredential(credential);
        expect(first).toStrictEqual(credential);
        expect(readCredential(first)).toStrictEqual(first);
        expect(validateCredential(first)).toStrictEqual(validateCredential(credential));
      }),
      RUNS,
    );
  });

  it("stop a hostile depth with a finding, whatever the depth is", () => {
    let deep: Record<string, unknown> = { id: "https://example.edu/issuers/1", type: ["Profile"] };
    for (let level = 0; level < 200_000; level += 1)
      deep = { id: "https://example.edu/issuers/1", type: ["Profile"], parentOrg: deep };
    const issues = validateCredential({ ...achievementCredential(), issuer: deep });
    expect(issues.map(({ path, rule }) => ({ path, rule }))).toStrictEqual([{ path: "", rule: "invalid-value" }]);
    expect(() => readCredential({ ...achievementCredential(), issuer: deep })).toThrow(DataError);
  });

  it("never let a property named __proto__ change a prototype, wherever it is", () => {
    fc.assert(
      fc.property(CREDENTIALS, fc.nat(), (credential, at) => {
        const text = JSON.stringify(credential);
        const braces = [...text.matchAll(/\{/gu)].map((match) => match.index);
        const place = braces[at % braces.length] ?? 0;
        const hostile = JSON.parse(`${text.slice(0, place + 1)}"__proto__":{"admin":true},${text.slice(place + 1)}`);
        try {
          expect(hasPlainPrototypes(readCredential(hostile))).toBe(true);
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
        expect(({} as Record<string, unknown>).admin).toBeUndefined();
      }),
      RUNS,
    );
  });
});
