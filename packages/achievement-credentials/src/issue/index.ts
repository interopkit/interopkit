/**
 * Builders of Open Badges and CLR credentials, the identity hash of a recipient, and the alignment of an achievement to an
 * item of a CASE framework.
 *
 * @module
 */
export { buildAchievementCredential } from "./build-achievement-credential.js";
export { buildClrCredential } from "./build-clr-credential.js";
export { buildEndorsementCredential } from "./build-endorsement-credential.js";
export { type CaseItem, caseAlignment } from "./case-alignment.js";
export { hashIdentifier, type KnownIdentity, matchesIdentifier } from "./identity.js";
export type { AchievementCredentialInput, ClrCredentialInput, EndorsementCredentialInput } from "./inputs.js";
