import { parseWith, strictRecord } from "@interopkit/core/checks";
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
}

const optionsSchema = strictRecord({ version: v.optional(v.picklist(CASE_VERSIONS)) });
const kindSchema = v.picklist(ENTITY_KINDS);

/** Checks the options of a read and returns the version that they ask for. */
export function readVersion(options: unknown): CaseVersion {
  return parseWith(optionsSchema, options === undefined ? {} : options, "The read options").version ?? "1.1";
}

/** Checks the kind of an entity that a caller asks for. */
export function readKind(kind: unknown): CaseEntityKind {
  return parseWith(kindSchema, kind, "The kind");
}
