import { DEFAULT_MAX_FINDINGS, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { CASE_VERSIONS, type CaseEntityKind, type CaseVersion, ENTITY_KINDS } from "../model/index.js";

/** The options of `readPackage`, `readEntity`, `validatePackage` and `validateEntity`. */
export interface ReadOptions {
  /**
   * The version of CASE that the value is in. Reading 1.0 refuses what only 1.1 has, and holds identifiers and URIs to the
   * stricter forms of the 1.0 schemas.
   *
   * @defaultValue `"1.1"`
   */
  readonly version?: CaseVersion;
  /**
   * The most findings that the call lists, or that `readPackage` and `readEntity` count errors up to before they stop. The
   * check stops at the first finding beyond the limit and ends the list with a finding that says so: a value that is wrong in
   * a million places costs the memory of the limit.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
}

const optionsSchema = strictRecord({
  version: v.optional(v.picklist(CASE_VERSIONS)),
  maxFindings: v.optional(positiveIntegerSchema),
});
const kindSchema = v.picklist(ENTITY_KINDS);

/** The version and the limit of findings that the options of a read ask for. */
export interface ReadSettings {
  readonly version: CaseVersion;
  readonly maxFindings: number;
}

/** Checks the options of a read and returns what they ask for. */
export function readSettings(options: unknown): ReadSettings {
  const checked = parseWith(optionsSchema, options === undefined ? {} : options, "The read options");
  return { version: checked.version ?? "1.1", maxFindings: checked.maxFindings ?? DEFAULT_MAX_FINDINGS };
}

/** Checks the kind of an entity that a caller asks for. */
export function readKind(kind: unknown): CaseEntityKind {
  return parseWith(kindSchema, kind, "The kind");
}
