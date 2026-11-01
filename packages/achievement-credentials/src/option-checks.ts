import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";

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
