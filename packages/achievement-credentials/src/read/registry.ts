import type { Schema } from "@interopkit/core/checks";
import type { CredentialKind, CredentialV1p1, Entity, EntityKind, IssuableCredential } from "../model/index.js";
import {
  getOpenBadgeCredentialsResponseSchema,
  imsxStatusInfoSchema,
  serviceDescriptionDocumentSchema,
} from "./api-schemas.js";
import {
  clrCredentialJwtPayloadSchema,
  clrCredentialSchema,
  clrCredentialV1p1Schema,
  clrSubjectJwtPayloadSchema,
  getClrCredentialsResponseSchema,
} from "./clr-schemas.js";
import {
  achievementCredentialSchema,
  achievementSchema,
  endorsementCredentialSchema,
  profileSchema,
  verifiableCredentialSchema,
} from "./credential-schemas.js";
import { jwkSchema, jwksSchema, multikeySchema } from "./key-schemas.js";
import {
  achievementCredentialV1p1Schema,
  endorsementCredentialV1p1Schema,
  verifiableCredentialV1p1Schema,
} from "./v1p1-schemas.js";

/** The schemas that read a kind of credential under each of the two data models. */
export const CREDENTIAL_SCHEMAS: Readonly<
  Record<CredentialKind, { readonly v2: Schema<IssuableCredential>; readonly v1p1: Schema<CredentialV1p1> }>
> = {
  AchievementCredential: { v2: achievementCredentialSchema, v1p1: achievementCredentialV1p1Schema },
  EndorsementCredential: { v2: endorsementCredentialSchema, v1p1: endorsementCredentialV1p1Schema },
  ClrCredential: { v2: clrCredentialSchema, v1p1: clrCredentialV1p1Schema },
  VerifiableCredential: { v2: verifiableCredentialSchema, v1p1: verifiableCredentialV1p1Schema },
};

/** The schemas that read an object that is not a credential, by the name of its class. */
export const ENTITY_SCHEMAS: Readonly<Record<EntityKind, Schema<Entity>>> = {
  Achievement: achievementSchema,
  Profile: profileSchema,
  GetOpenBadgeCredentialsResponse: getOpenBadgeCredentialsResponseSchema,
  GetClrCredentialsResponse: getClrCredentialsResponseSchema,
  ClrCredentialJwtPayload: clrCredentialJwtPayloadSchema,
  ClrSubjectJwtPayload: clrSubjectJwtPayloadSchema,
  imsx_StatusInfo: imsxStatusInfoSchema,
  ServiceDescriptionDocument: serviceDescriptionDocumentSchema,
  Multikey: multikeySchema,
  JWK: jwkSchema,
  JWKS: jwksSchema,
};
