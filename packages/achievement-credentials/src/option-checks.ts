import { DataError } from "@interopkit/core";
import { checkArray, describe, methodsSchema, parseWith } from "@interopkit/core/checks";
import type { DataIntegritySuite, KeyResolver } from "./model/index.js";

/**
 * Checks an option that is a flag, as a host passes it from JavaScript.
 *
 * @param value - The value of the option.
 * @param label - Names the option in the message, such as `The option allowUnboundKeys`.
 * @throws `DataError` when it is not `true` or `false`.
 */
export function checkFlag(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new DataError(`${label} must be true or false, found ${describe(value)}.`);
}

/** The schema of a `KeyResolver` that a host passes: an object with the functions `resolve` and `issuerKeys`. */
export const keyResolverSchema = methodsSchema<KeyResolver>("resolve", "issuerKeys");

const suiteSchema = methodsSchema<DataIntegritySuite>("verify");

/**
 * Checks the Data Integrity suites that a host passes, as it passes them from JavaScript.
 *
 * @param value - The option `suites`.
 * @returns The suites.
 * @throws `DataError` when it is not an array of objects with a `verify` function and the name of their `cryptosuite`.
 */
export function readSuites(value: unknown): readonly DataIntegritySuite[] {
  checkArray(value, "The option suites must be an array");
  return value.map((suite, index) => {
    const read = parseWith(suiteSchema, suite, `The option suites[${index}]`);
    if (typeof read.cryptosuite !== "string" || read.cryptosuite === "") {
      throw new DataError(`The option suites[${index}] must name its cryptosuite.`);
    }
    return read;
  });
}
