import { parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { CREDENTIAL_KINDS, type CredentialKind, ENTITY_KINDS, type EntityKind } from "../model/index.js";

/** The options of `readCredential` and `validateCredential`. */
export interface ReadOptions {
  /**
   * The kind of credential that the value must be. The default reads the kind from the `type` of the value: a type that
   * includes `ClrCredential`, `EndorsementCredential`, `AchievementCredential` or `OpenBadgeCredential` (in that order) names
   * that kind, and any other type a `VerifiableCredential`.
   *
   * @defaultValue the kind that the `type` names
   */
  readonly kind?: CredentialKind;
}

const optionsSchema = strictRecord({ kind: v.optional(v.picklist(CREDENTIAL_KINDS)) });
const kindSchema = v.picklist(ENTITY_KINDS);

/** Checks the options of a read and returns the kind that they ask for, if any. */
export function readKind(options: unknown): CredentialKind | undefined {
  return parseWith(optionsSchema, options === undefined ? {} : options, "The read options").kind;
}

/** Checks the kind of an object that a caller asks for. */
export function readEntityKind(kind: unknown): EntityKind {
  return parseWith(kindSchema, kind, "The kind");
}
