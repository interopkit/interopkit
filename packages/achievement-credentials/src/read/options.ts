import { DEFAULT_MAX_FINDINGS, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { CREDENTIAL_KINDS, type CredentialKind, ENTITY_KINDS, type EntityKind } from "../model/index.js";

/** The options of `readCredential` and `validateCredential`. */
export interface ReadOptions {
  /**
   * The kind of credential of Open Badges 3.0 or CLR 2.0 that the value must be. The default reads an Open Badges 2.0
   * assertion as one, and reads the kind of any other value from its `type`: a type that includes `ClrCredential`,
   * `EndorsementCredential`, `AchievementCredential` or `OpenBadgeCredential` (in that order) names that kind, and any other
   * type a `VerifiableCredential`.
   *
   * @defaultValue an Open Badges 2.0 assertion, or the kind that the `type` names
   */
  readonly kind?: CredentialKind;
  /**
   * The most findings that the call lists, or that `readCredential` and `readEntity` count errors up to before they stop. The
   * check stops at the first finding beyond the limit and ends the list with a finding that says so: a value that is wrong in
   * a million places costs the memory of the limit.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
}

/** The options of `readEntity` and `validateEntity`. */
export interface EntityReadOptions {
  /**
   * The most findings that the call lists, or that `readEntity` counts errors up to before it stops. The check stops at the
   * first finding beyond the limit and ends the list with a finding that says so.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
}

const optionsSchema = strictRecord({
  kind: v.optional(v.picklist(CREDENTIAL_KINDS)),
  maxFindings: v.optional(positiveIntegerSchema),
});
const entityOptionsSchema = strictRecord({ maxFindings: v.optional(positiveIntegerSchema) });
const kindSchema = v.picklist(ENTITY_KINDS);

/** The kind of credential and the limit of findings that the options of a read ask for. */
export interface ReadSettings {
  readonly kind: CredentialKind | undefined;
  readonly maxFindings: number;
}

/** Checks the options of a read of a credential and returns what they ask for. */
export function readSettings(options: unknown): ReadSettings {
  const checked = parseWith(optionsSchema, options === undefined ? {} : options, "The read options");
  return { kind: checked.kind, maxFindings: checked.maxFindings ?? DEFAULT_MAX_FINDINGS };
}

/** Checks the options of a read of an object that is not a credential and returns the limit of findings. */
export function readEntityLimit(options: unknown): number {
  return (
    parseWith(entityOptionsSchema, options === undefined ? {} : options, "The read options").maxFindings ??
    DEFAULT_MAX_FINDINGS
  );
}

/** Checks the kind of an object that a caller asks for. */
export function readEntityKind(kind: unknown): EntityKind {
  return parseWith(kindSchema, kind, "The kind");
}
