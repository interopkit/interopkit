import { DEFAULT_MAX_FINDINGS, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";

/** The options of `validateEvent` and `validateEntity`. */
export interface ValidateOptions {
  /**
   * The most findings that the call lists. The check stops at the first finding beyond the limit and ends the list with a
   * finding that says so: a value that is wrong in a million places costs the memory of the limit.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
}

const optionsSchema = strictRecord({ maxFindings: v.optional(positiveIntegerSchema) });

/**
 * Checks the options of a call and returns the limit of findings.
 *
 * @throws `DataError` when the options are not an object with a `maxFindings` that is a positive integer.
 */
export function readMaxFindings(options: unknown): number {
  const checked = parseWith(optionsSchema, options === undefined ? {} : options, "The validate options");
  return checked.maxFindings ?? DEFAULT_MAX_FINDINGS;
}
