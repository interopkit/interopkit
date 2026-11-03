import { checkFunction, checkNonNegativeInteger, checkRecord } from "./checks.js";

/**
 * The source of the current time. A host passes one where it or a test must control the time; an option of this type that is
 * left out is `SYSTEM_CLOCK`.
 */
export interface Clock {
  /**
   * Returns the current time.
   *
   * @returns Whole milliseconds since 1970-01-01T00:00:00Z, as `Date.now()` does.
   */
  now(): number;
}

/** The clock of the system, for a host that has no reason to control the time. */
export const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

/**
 * Checks the option `clock`, as a host passes it from JavaScript: a clock, or `undefined` for `SYSTEM_CLOCK`.
 *
 * @throws `DataError` when it is given and is not an object with a function `now`.
 */
export function checkClock(value: unknown): asserts value is Clock | undefined {
  if (value === undefined) return;
  checkRecord(value, "The option clock must be an object");
  checkFunction(value.now, "The function now of the option clock must be a function");
}

/**
 * Reads the time from a clock that has been checked.
 *
 * @param clock - The clock. Default: `SYSTEM_CLOCK`.
 * @returns Whole milliseconds since 1970-01-01T00:00:00Z.
 * @throws `DataError` when the clock does not answer with a non-negative integer.
 */
export function readClock(clock: Clock = SYSTEM_CLOCK): number {
  const now = clock.now();
  checkNonNegativeInteger(now, "The time of the clock");
  return now;
}
