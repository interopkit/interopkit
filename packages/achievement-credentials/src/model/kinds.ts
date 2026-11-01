import type { GetOpenBadgeCredentialsResponse, ImsxStatusInfo, ServiceDescriptionDocument } from "./api.js";
import type {
  ClrCredential,
  ClrCredentialJwtPayload,
  ClrCredentialV1p1,
  ClrSubjectJwtPayload,
  GetClrCredentialsResponse,
} from "./clr.js";
import type {
  Achievement,
  AchievementCredential,
  EndorsementCredential,
  Profile,
  VerifiableCredential,
} from "./credentials.js";
import type {
  AchievementCredentialV1p1,
  EndorsementCredentialV1p1,
  VerifiableCredentialV1p1,
} from "./credentials-v1p1.js";
import type { JWK, JWKS, Multikey } from "./keys.js";

/**
 * The kinds of credential that the readers tell apart, by the class that the `type` of a credential names. A credential of
 * another class is a `VerifiableCredential`.
 */
export const CREDENTIAL_KINDS = [
  "AchievementCredential",
  "EndorsementCredential",
  "ClrCredential",
  "VerifiableCredential",
] as const;

/** The name of a kind of credential. */
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** A credential under the Verifiable Credentials Data Model 2.0, which the package builds, signs and checks for status. */
export type IssuableCredential = AchievementCredential | EndorsementCredential | ClrCredential | VerifiableCredential;

/** A credential under the Verifiable Credentials Data Model 1.1, which the package reads and verifies and never writes. */
export type CredentialV1p1 =
  | AchievementCredentialV1p1
  | EndorsementCredentialV1p1
  | ClrCredentialV1p1
  | VerifiableCredentialV1p1;

/** A credential of either data model. */
export type AnyCredential = IssuableCredential | CredentialV1p1;

/**
 * The objects besides credentials that the readers read by the name of their class: the ones that are published or exchanged
 * on their own.
 */
export const ENTITY_KINDS = [
  "Achievement",
  "Profile",
  "GetOpenBadgeCredentialsResponse",
  "GetClrCredentialsResponse",
  "ClrCredentialJwtPayload",
  "ClrSubjectJwtPayload",
  "imsx_StatusInfo",
  "ServiceDescriptionDocument",
  "Multikey",
  "JWK",
  "JWKS",
] as const;

/** The name of the class of an object that is not a credential. */
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** An object that is not a credential, of one of the classes of `ENTITY_KINDS`. */
export type Entity =
  | Achievement
  | Profile
  | GetOpenBadgeCredentialsResponse
  | GetClrCredentialsResponse
  | ClrCredentialJwtPayload
  | ClrSubjectJwtPayload
  | ImsxStatusInfo
  | ServiceDescriptionDocument
  | Multikey
  | JWK
  | JWKS;
