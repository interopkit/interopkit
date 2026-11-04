import { isDeepStrictEqual } from "node:util";

/** The matchers of Vitest that the fakes of the tests assert with, each judging an actual value against what it expects. */
const MATCHERS: Readonly<Record<string, (actual: never, expected: never) => boolean>> = {
  toBe: (actual, expected) => Object.is(actual, expected),
  toEqual: (actual, expected) => isDeepStrictEqual(actual, expected),
  toBeDefined: (actual) => actual !== undefined,
  toBeUndefined: (actual) => actual === undefined,
  toBeTruthy: (actual) => Boolean(actual),
  toBeGreaterThan: (actual: number, expected: number) => actual > expected,
  toBeLessThanOrEqual: (actual: number, expected: number) => actual <= expected,
  toBeInstanceOf: (actual: object, expected: new (...args: never[]) => unknown) => actual instanceof expected,
  toContain: (actual: string | readonly unknown[], expected: string) => actual.includes(expected),
  toMatch: (actual: string, expected: RegExp | string) =>
    typeof expected === "string" ? actual.includes(expected) : expected.test(actual),
};

/** The assertion of a fake that fails, with the sentence of the fake when it gave one. */
class ExpectationError extends Error {
  override name = "ExpectationError";
}

/**
 * The `expect` that the fakes of the tests import from Vitest, for the process of a reading, which has no test runner: the
 * matchers the fakes use, on plain comparison, so that a fake still refuses what it is built to refuse.
 */
export function expect(actual: unknown, message?: string) {
  const judge = (negate: boolean) =>
    new Proxy(
      {},
      {
        get: (_, name) => {
          if (name === "not") return judge(!negate);
          const matcher = typeof name === "string" && Object.hasOwn(MATCHERS, name) ? MATCHERS[name] : undefined;
          if (matcher === undefined)
            throw new ExpectationError(`The matcher ${String(name)} is not one of the fakes'.`);
          return (expected?: never) => {
            if (matcher(actual as never, expected as never) === negate) {
              throw new ExpectationError(
                message ?? `Expected ${String(actual)} ${negate ? "not " : ""}${String(name)} ${String(expected)}.`,
              );
            }
          };
        },
      },
    );
  return judge(false);
}
