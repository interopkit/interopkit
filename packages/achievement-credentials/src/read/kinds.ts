import type { CredentialKind } from "../model/index.js";

/** The kinds of credential that Open Badges 9 and CLR 8 give an algorithm of verification, and that a summary shows. */
export type VerifiedKind = "badge" | "endorsement" | "clr";

/** The classes whose name in `type` says what kind of credential a value is, strongest first, with the kind each is verified as. */
const KIND_TYPES: readonly (readonly [CredentialKind, VerifiedKind, readonly string[]])[] = [
  ["ClrCredential", "clr", ["ClrCredential"]],
  ["EndorsementCredential", "endorsement", ["EndorsementCredential"]],
  ["AchievementCredential", "badge", ["AchievementCredential", "OpenBadgeCredential"]],
];

/** Finds the strongest class that a `type` names. */
function classOf(type: unknown): (typeof KIND_TYPES)[number] | undefined {
  const names = Array.isArray(type) ? type : [type];
  return KIND_TYPES.find(([, , classes]) => classes.some((name) => names.includes(name)));
}

/**
 * Reads the kind of credential that the `type` of a value names: the strongest class among `ClrCredential`,
 * `EndorsementCredential`, and `AchievementCredential` or `OpenBadgeCredential`, else a `VerifiableCredential`.
 *
 * @param type - The `type` of the value: one name or a list of them.
 */
export function kindOfType(type: unknown): CredentialKind {
  return classOf(type)?.[0] ?? "VerifiableCredential";
}

/**
 * Reads the kind of credential that Open Badges 9 and CLR 8 verify from its `type`, or `undefined` for a credential of no class
 * of theirs.
 *
 * @param type - The `type` of the credential.
 */
export function verifiedKindOf(type: unknown): VerifiedKind | undefined {
  return classOf(type)?.[1];
}
