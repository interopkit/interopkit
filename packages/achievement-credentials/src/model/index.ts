/**
 * The model of Open Badges 3.0 and CLR 2.0: the classes of a credential under both data models, the models of the APIs and
 * of keys, the vocabularies, and the findings of the readers.
 *
 * @module
 */
export {
  CREDENTIAL_APIS,
  type CredentialApi,
  type GetOpenBadgeCredentialsResponse,
  type ImsxCodeMinor,
  type ImsxCodeMinorField,
  type ImsxStatusInfo,
  type OpenApiComponents,
  type OpenApiInfo,
  type OpenApiOAuth2SecurityScheme,
  type OpenApiSecuritySchemes,
  type ServiceDescriptionDocument,
} from "./api.js";
export type {
  Association,
  ClrCredential,
  ClrCredentialJwtPayload,
  ClrCredentialV1p1,
  ClrSubject,
  ClrSubjectJwtPayload,
  ClrSubjectV1p1,
  GetClrCredentialsResponse,
} from "./clr.js";
export { CONTEXTS, type ContextEntry } from "./context.js";
export type {
  Achievement,
  AchievementCredential,
  AchievementSubject,
  Address,
  Alignment,
  CredentialSchema,
  CredentialStatus,
  CredentialSubject,
  Criteria,
  EndorsementCredential,
  EndorsementSubject,
  Evidence,
  GeoCoordinates,
  IdentifierEntry,
  IdentityObject,
  Image,
  Profile,
  ProfileRef,
  Proof,
  RefreshService,
  Related,
  Result,
  ResultDescription,
  RubricCriterionLevel,
  TermsOfUse,
  VerifiableCredential,
} from "./credentials.js";
export type {
  AchievementCredentialV1p1,
  AchievementSubjectV1p1,
  AchievementV1p1,
  EndorsementCredentialV1p1,
  ProfileV1p1,
  VerifiableCredentialV1p1,
} from "./credentials-v1p1.js";
export type { CredentialIssue } from "./issue.js";
export type { JWK, JWKS, Multikey } from "./keys.js";
export {
  type AnyCredential,
  CREDENTIAL_KINDS,
  type CredentialKind,
  type CredentialV1p1,
  ENTITY_KINDS,
  type Entity,
  type EntityByKind,
  type EntityKind,
  type IssuableCredential,
} from "./kinds.js";
export {
  ACHIEVEMENT_TYPES,
  type AchievementType,
  ALIGNMENT_TARGET_TYPES,
  type AlignmentTargetType,
  ASSOCIATION_TYPES,
  type AssociationType,
  AUTHORIZATION_ERRORS,
  type AuthorizationError,
  type ExtensionTerm,
  IDENTIFIER_TYPES,
  type IdentifierType,
  REGISTRATION_ERRORS,
  RESULT_STATUS_TYPES,
  RESULT_TYPES,
  type RegistrationError,
  type ResultStatusType,
  type ResultType,
  STATUS_CODES_MAJOR,
  STATUS_CODES_MINOR,
  STATUS_SEVERITIES,
  type StatusCodeMajor,
  type StatusCodeMinorValue,
  type StatusSeverity,
  TOKEN_ERRORS,
  type TokenError,
} from "./vocabularies.js";
