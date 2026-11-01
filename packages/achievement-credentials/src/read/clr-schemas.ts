/**
 * The schemas that read the classes of CLR 2.0 (CLR B.1 to B.3), and the form of a ClrCredential in a JWT.
 *
 * @module
 */

import { dateTimeSchema, openRecord, type Schema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type {
  Association,
  ClrCredential,
  ClrCredentialJwtPayload,
  ClrCredentialV1p1,
  ClrSubject,
  ClrSubjectJwtPayload,
  ClrSubjectV1p1,
  GetClrCredentialsResponse,
} from "../model/index.js";
import { ASSOCIATION_TYPES, CONTEXTS } from "../model/index.js";
import {
  achievementSchema,
  credentialSchemaSchema,
  credentialStatusSchema,
  endorsementCredentialSchema,
  evidenceSchema,
  identityObjectSchema,
  imageSchema,
  profileRefSchema,
  proofSchema,
  refreshServiceSchema,
  termsOfUseSchema,
  verifiableCredentialSchema,
} from "./credential-schemas.js";
import { CLR_CONTEXT_PATTERN, contextSchema, jws, many, OB_CONTEXT_PATTERN, ref, text, types } from "./primitives.js";
import {
  achievementV1p1Schema,
  endorsementCredentialV1p1Schema,
  profileV1p1Schema,
  verifiableCredentialV1p1Schema,
} from "./v1p1-schemas.js";

export const clrCredentialSchema: Schema<ClrCredential> = openRecord({
  "@context": contextSchema([CONTEXTS.credentialsV2, CLR_CONTEXT_PATTERN, OB_CONTEXT_PATTERN]),
  type: types("VerifiableCredential", "ClrCredential"),
  id: text,
  name: text,
  description: v.optional(text),
  endorsement: v.optional(many(ref(() => endorsementCredentialSchema))),
  endorsementJwt: v.optional(many(jws)),
  image: v.optional(ref(() => imageSchema)),
  partial: v.optional(v.boolean()),
  credentialSubject: ref(() => clrSubjectSchema),
  awardedDate: v.optional(dateTimeSchema),
  issuer: ref(() => profileRefSchema),
  validFrom: dateTimeSchema,
  validUntil: v.optional(dateTimeSchema),
  proof: v.optional(many(ref(() => proofSchema))),
  credentialSchema: v.optional(many(ref(() => credentialSchemaSchema))),
  credentialStatus: v.optional(ref(() => credentialStatusSchema)),
  refreshService: v.optional(ref(() => refreshServiceSchema)),
  termsOfUse: v.optional(many(ref(() => termsOfUseSchema))),
  evidence: v.optional(many(ref(() => evidenceSchema))),
});

export const clrSubjectSchema: Schema<ClrSubject> = openRecord({
  id: v.optional(text),
  type: types("ClrSubject"),
  identifier: v.optional(many(ref(() => identityObjectSchema))),
  achievement: v.optional(many(ref(() => achievementSchema))),
  verifiableCredential: many(
    ref(() => verifiableCredentialSchema),
    1,
  ),
  association: v.optional(many(ref(() => associationSchema))),
});

export const associationSchema: Schema<Association> = strictRecord({
  type: v.literal("Association"),
  associationType: v.picklist(ASSOCIATION_TYPES),
  sourceId: text,
  targetId: text,
});

export const clrCredentialV1p1Schema: Schema<ClrCredentialV1p1> = openRecord({
  "@context": contextSchema([CONTEXTS.credentialsV1, CLR_CONTEXT_PATTERN, OB_CONTEXT_PATTERN]),
  type: types("VerifiableCredential", "ClrCredential"),
  id: text,
  name: text,
  description: v.optional(text),
  endorsement: v.optional(many(ref(() => endorsementCredentialV1p1Schema))),
  endorsementJwt: v.optional(many(jws)),
  image: v.optional(ref(() => imageSchema)),
  partial: v.optional(v.boolean()),
  credentialSubject: ref(() => clrSubjectV1p1Schema),
  awardedDate: v.optional(dateTimeSchema),
  issuer: ref(() => profileV1p1Schema),
  issuanceDate: dateTimeSchema,
  expirationDate: v.optional(dateTimeSchema),
  proof: v.optional(many(ref(() => proofSchema))),
  credentialSchema: v.optional(many(ref(() => credentialSchemaSchema))),
  credentialStatus: v.optional(ref(() => credentialStatusSchema)),
  refreshService: v.optional(ref(() => refreshServiceSchema)),
  termsOfUse: v.optional(many(ref(() => termsOfUseSchema))),
  evidence: v.optional(many(ref(() => evidenceSchema))),
});

export const clrSubjectV1p1Schema: Schema<ClrSubjectV1p1> = openRecord({
  id: v.optional(text),
  type: types("ClrSubject"),
  identifier: v.optional(many(ref(() => identityObjectSchema))),
  achievement: v.optional(many(ref(() => achievementV1p1Schema))),
  verifiableCredential: many(
    ref(() => verifiableCredentialV1p1Schema),
    1,
  ),
  association: v.optional(many(ref(() => associationSchema))),
});

export const clrCredentialJwtPayloadSchema: Schema<ClrCredentialJwtPayload> = openRecord({
  credentialSubject: ref(() => clrSubjectJwtPayloadSchema),
  "@context": contextSchema([CONTEXTS.credentialsV2, CLR_CONTEXT_PATTERN, OB_CONTEXT_PATTERN]),
  id: text,
  type: types("VerifiableCredential", "ClrCredential"),
  issuer: ref(() => profileRefSchema),
  validFrom: dateTimeSchema,
  validUntil: v.optional(dateTimeSchema),
  proof: v.optional(many(ref(() => proofSchema))),
  credentialSchema: v.optional(many(ref(() => credentialSchemaSchema))),
  credentialStatus: v.optional(ref(() => credentialStatusSchema)),
  refreshService: v.optional(ref(() => refreshServiceSchema)),
  termsOfUse: v.optional(many(ref(() => termsOfUseSchema))),
  evidence: v.optional(many(ref(() => evidenceSchema))),
  name: text,
  description: v.optional(text),
  endorsement: v.optional(many(ref(() => endorsementCredentialSchema))),
  endorsementJwt: v.optional(many(jws)),
  image: v.optional(ref(() => imageSchema)),
  partial: v.optional(v.boolean()),
  awardedDate: v.optional(dateTimeSchema),
});

export const clrSubjectJwtPayloadSchema: Schema<ClrSubjectJwtPayload> = openRecord({
  verifiableCredential: many(jws, 1),
  id: v.optional(text),
  type: types("ClrSubject"),
  identifier: v.optional(many(ref(() => identityObjectSchema))),
  achievement: v.optional(many(ref(() => achievementSchema))),
  association: v.optional(many(ref(() => associationSchema))),
});

export const getClrCredentialsResponseSchema: Schema<GetClrCredentialsResponse> = strictRecord({
  credential: v.optional(many(ref(() => clrCredentialSchema))),
  compactJwsString: v.optional(many(jws)),
});
