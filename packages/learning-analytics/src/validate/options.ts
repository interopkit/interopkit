import { DEFAULT_MAX_FINDINGS, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type { CaliperVersion } from "../model/index.js";
import { type ReadOptions, versionSchema } from "../read/internal.js";

/** The options of `validateEvent` and `validateEntity`. */
export interface ValidateOptions extends ReadOptions {
  /**
   * The most findings that the call lists. The check stops at the first finding beyond the limit and ends the list with a
   * finding that says so: a value that is wrong in a million places costs the memory of the limit.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
}

const optionsSchema = strictRecord({
  version: v.optional(versionSchema),
  maxFindings: v.optional(positiveIntegerSchema),
});

/** What a call reads from its options: the version that governs the value and the limit of findings. */
export interface ValidateSettings {
  /** The version of Caliper that governs the value. */
  readonly version: CaliperVersion;
  /** The most findings that the call lists. */
  readonly maxFindings: number;
}

/**
 * Checks the options of a call and returns the version and the limit of findings.
 *
 * @throws `DataError` when the options are not an object with a `version` that the readers know and a `maxFindings` that is a
 * positive integer.
 */
export function readValidateOptions(options: unknown): ValidateSettings {
  const checked = parseWith(optionsSchema, options === undefined ? {} : options, "The validate options");
  return { version: checked.version ?? "1.2", maxFindings: checked.maxFindings ?? DEFAULT_MAX_FINDINGS };
}
