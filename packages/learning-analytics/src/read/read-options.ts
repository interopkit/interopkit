import { parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { CALIPER_VERSIONS, type CaliperVersion } from "../model/index.js";

/** The options of `readEvent`, `readEntity`, `validateEvent` and `validateEntity`. */
export interface ReadOptions {
  /**
   * The version of Caliper that governs the document: 1.2 is read as the model has it, and 1.1 as its own tables define it, with the
   * classes, properties and actions that 1.1 deprecated or 1.2 added refused.
   *
   * @defaultValue "1.2"
   */
  readonly version?: CaliperVersion;
}

/** The schema of a version of Caliper that the readers know. */
export const versionSchema = v.picklist(
  CALIPER_VERSIONS,
  (issue) => `expected a version of Caliper that the readers know, 1.2 or 1.1, found ${issue.received}`,
);

const readOptionsSchema = strictRecord({ version: v.optional(versionSchema) });

/**
 * Checks the options of a reader and returns the version.
 *
 * @param options - The options of the call, or `undefined`.
 * @param label - Names the options in the error message.
 * @throws `DataError` when the options are not an object whose `version` is a version of Caliper that the readers know.
 */
export function versionOf(options: unknown, label: string): CaliperVersion {
  return parseWith(readOptionsSchema, options === undefined ? {} : options, label).version ?? "1.2";
}
