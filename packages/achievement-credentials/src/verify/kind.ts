import type { AnyVerifiableCredential } from "../model/index.js";

/** The kinds of credential that Open Badges 9 and CLR 8 give an algorithm of verification. */
export type VerifiedKind = "badge" | "endorsement" | "clr";

/** The names in `type` that give each kind, strongest first. */
const KINDS: readonly (readonly [VerifiedKind, readonly string[]])[] = [
  ["clr", ["ClrCredential"]],
  ["endorsement", ["EndorsementCredential"]],
  ["badge", ["AchievementCredential", "OpenBadgeCredential"]],
];

/** Returns the kind that the `type` of a credential names, or `undefined` for a credential of another class. */
export function kindOf(credential: AnyVerifiableCredential): VerifiedKind | undefined {
  return KINDS.find(([, names]) => names.some((name) => credential.type.includes(name)))?.[0];
}
