import { isRecord } from "@interopkit/core/checks";
import type { AnyVerifiableCredential } from "../model/index.js";

/** Returns what a property holds as a list: its members, or none when it is absent. */
function listOf(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The properties that hold credentials of their own, whose endorsements are theirs: an endorsement is verified without its
 * endorsements (Open Badges 9.2), and a credential that a CLR holds is verified on its own.
 */
const OWN_CREDENTIALS: ReadonlySet<string> = new Set(["endorsement", "endorsementJwt", "verifiableCredential"]);

/**
 * Returns the endorsements that a credential carries (Open Badges 9.1: any EndorsementCredential it contains), as objects and as
 * compact JWS, wherever they are: its own, its issuer's and that issuer's parent organizations', those of its achievements and of
 * their creators, and those of the source of its subject. The credential has been read within the levels of the input.
 */
export function endorsementsOf(credential: AnyVerifiableCredential): readonly unknown[] {
  const found: unknown[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!isRecord(node)) return;
    for (const endorsement of [...listOf(node.endorsement), ...listOf(node.endorsementJwt)]) found.push(endorsement);
    for (const [name, value] of Object.entries(node)) if (!OWN_CREDENTIALS.has(name)) walk(value);
  };
  walk(credential);
  return found;
}

/** Returns the credentials that a CLR holds in its subject, as objects and as compact JWS (CLR 8.1). */
export function heldCredentialsOf(credential: AnyVerifiableCredential): readonly unknown[] {
  // The reader refuses a subject that is not one object.
  return listOf((credential.credentialSubject as Readonly<Record<string, unknown>>).verifiableCredential);
}
