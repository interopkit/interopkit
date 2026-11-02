import { isRecord } from "@interopkit/core/checks";
import type { AnyVerifiableCredential } from "../model/index.js";

/** Returns what a property holds as a list: its members, or none when it is absent. */
function listOf(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** The endorsements that an entity carries, as objects and as compact JWS. */
function endorsementsOfEntity(entity: unknown): readonly unknown[] {
  return isRecord(entity) ? [...listOf(entity.endorsement), ...listOf(entity.endorsementJwt)] : [];
}

/**
 * Returns the endorsements that a credential carries (Open Badges 9.1: any EndorsementCredential it contains): its own, those of
 * its issuer's profile and those of the achievements of its subject.
 */
export function endorsementsOf(credential: AnyVerifiableCredential): readonly unknown[] {
  const subject: unknown = credential.credentialSubject;
  const achievements = isRecord(subject) ? listOf(subject.achievement) : [];
  return [credential, credential.issuer, ...achievements].flatMap(endorsementsOfEntity);
}

/** Returns the credentials that a CLR holds in its subject, as objects and as compact JWS (CLR 8.1). */
export function heldCredentialsOf(credential: AnyVerifiableCredential): readonly unknown[] {
  const subject: unknown = credential.credentialSubject;
  return isRecord(subject) ? listOf(subject.verifiableCredential) : [];
}
