/**
 * The schemas that read the classes that Open Badges 3.0 and CLR 2.0 share (OB B.1, CLR B.4), under the Verifiable Credentials Data Model 2.0.
 *
 * @module
 */

import {
  dateSchema,
  dateTimeSchema,
  finiteSchema,
  openRecord,
  type Schema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import type {
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
} from "../model/index.js";
import {
  ACHIEVEMENT_TYPES,
  ALIGNMENT_TARGET_TYPES,
  CONTEXTS,
  IDENTIFIER_TYPES,
  RESULT_STATUS_TYPES,
  RESULT_TYPES,
} from "../model/index.js";
import {
  contextSchema,
  jws,
  language,
  many,
  OB_CONTEXT_PATTERN,
  openEnumeration,
  ref,
  text,
  types,
} from "./primitives.js";

/** An issuer: a profile, or the URI of one. */
export const profileRefSchema: Schema<ProfileRef> = v.lazy((input) =>
  typeof input === "string" ? text : ref(() => profileSchema),
);

export const achievementSchema: Schema<Achievement> = openRecord({
  id: text,
  type: types("Achievement"),
  alignment: v.optional(many(ref(() => alignmentSchema))),
  achievementType: v.optional(openEnumeration(ACHIEVEMENT_TYPES, "an achievement type")),
  creator: v.optional(ref(() => profileSchema)),
  creditsAvailable: v.optional(finiteSchema),
  criteria: ref(() => criteriaSchema),
  description: text,
  endorsement: v.optional(many(ref(() => endorsementCredentialSchema))),
  endorsementJwt: v.optional(many(jws)),
  fieldOfStudy: v.optional(text),
  humanCode: v.optional(text),
  image: v.optional(ref(() => imageSchema)),
  inLanguage: v.optional(language),
  name: text,
  otherIdentifier: v.optional(many(ref(() => identifierEntrySchema))),
  related: v.optional(many(ref(() => relatedSchema))),
  resultDescription: v.optional(many(ref(() => resultDescriptionSchema))),
  specialization: v.optional(text),
  tag: v.optional(many(text)),
  version: v.optional(text),
});

export const achievementCredentialSchema: Schema<AchievementCredential> = openRecord({
  "@context": contextSchema([CONTEXTS.credentialsV2, OB_CONTEXT_PATTERN]),
  id: text,
  type: types("VerifiableCredential", ["AchievementCredential", "OpenBadgeCredential"]),
  name: v.optional(text),
  description: v.optional(text),
  image: v.optional(ref(() => imageSchema)),
  awardedDate: v.optional(dateTimeSchema),
  credentialSubject: ref(() => achievementSubjectSchema),
  endorsement: v.optional(many(ref(() => endorsementCredentialSchema))),
  endorsementJwt: v.optional(many(jws)),
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

export const achievementSubjectSchema: Schema<AchievementSubject> = openRecord({
  id: v.optional(text),
  type: types("AchievementSubject"),
  activityEndDate: v.optional(dateTimeSchema),
  activityStartDate: v.optional(dateTimeSchema),
  creditsEarned: v.optional(finiteSchema),
  achievement: ref(() => achievementSchema),
  identifier: v.optional(many(ref(() => identityObjectSchema))),
  image: v.optional(ref(() => imageSchema)),
  licenseNumber: v.optional(text),
  narrative: v.optional(text),
  result: v.optional(many(ref(() => resultSchema))),
  role: v.optional(text),
  source: v.optional(ref(() => profileSchema)),
  term: v.optional(text),
});

export const addressSchema: Schema<Address> = openRecord({
  type: types("Address"),
  addressCountry: v.optional(text),
  addressCountryCode: v.optional(text),
  addressRegion: v.optional(text),
  addressLocality: v.optional(text),
  streetAddress: v.optional(text),
  postOfficeBoxNumber: v.optional(text),
  postalCode: v.optional(text),
  geo: v.optional(ref(() => geoCoordinatesSchema)),
});

export const alignmentSchema: Schema<Alignment> = openRecord({
  type: types("Alignment"),
  targetCode: v.optional(text),
  targetDescription: v.optional(text),
  targetName: text,
  targetFramework: v.optional(text),
  targetType: v.optional(openEnumeration(ALIGNMENT_TARGET_TYPES, "an alignment target type")),
  targetUrl: text,
});

export const criteriaSchema: Schema<Criteria> = openRecord({
  id: v.optional(text),
  narrative: v.optional(text),
});

export const endorsementCredentialSchema: Schema<EndorsementCredential> = openRecord({
  "@context": contextSchema([CONTEXTS.credentialsV2, OB_CONTEXT_PATTERN]),
  type: types("VerifiableCredential", "EndorsementCredential"),
  id: text,
  name: text,
  description: v.optional(text),
  credentialSubject: ref(() => endorsementSubjectSchema),
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

export const endorsementSubjectSchema: Schema<EndorsementSubject> = openRecord({
  id: text,
  type: types("EndorsementSubject"),
  endorsementComment: v.optional(text),
});

export const evidenceSchema: Schema<Evidence> = openRecord({
  id: v.optional(text),
  type: types("Evidence"),
  narrative: v.optional(text),
  name: v.optional(text),
  description: v.optional(text),
  genre: v.optional(text),
  audience: v.optional(text),
});

export const geoCoordinatesSchema: Schema<GeoCoordinates> = openRecord({
  type: v.literal("GeoCoordinates"),
  latitude: finiteSchema,
  longitude: finiteSchema,
});

export const identifierEntrySchema: Schema<IdentifierEntry> = strictRecord({
  type: v.literal("IdentifierEntry"),
  identifier: text,
  identifierType: openEnumeration(IDENTIFIER_TYPES, "an identifier type"),
});

export const identityObjectSchema: Schema<IdentityObject> = strictRecord({
  type: v.literal("IdentityObject"),
  hashed: v.boolean(),
  identityHash: text,
  identityType: openEnumeration(IDENTIFIER_TYPES, "an identifier type"),
  salt: v.optional(text),
});

export const imageSchema: Schema<Image> = strictRecord({
  id: text,
  type: v.literal("Image"),
  caption: v.optional(text),
});

export const profileSchema: Schema<Profile> = openRecord({
  id: text,
  type: types("Profile"),
  name: v.optional(text),
  url: v.optional(text),
  phone: v.optional(text),
  description: v.optional(text),
  endorsement: v.optional(many(ref(() => endorsementCredentialSchema))),
  endorsementJwt: v.optional(many(jws)),
  image: v.optional(ref(() => imageSchema)),
  email: v.optional(text),
  address: v.optional(ref(() => addressSchema)),
  otherIdentifier: v.optional(many(ref(() => identifierEntrySchema))),
  official: v.optional(text),
  parentOrg: v.optional(ref(() => profileSchema)),
  familyName: v.optional(text),
  givenName: v.optional(text),
  additionalName: v.optional(text),
  patronymicName: v.optional(text),
  honorificPrefix: v.optional(text),
  honorificSuffix: v.optional(text),
  familyNamePrefix: v.optional(text),
  dateOfBirth: v.optional(dateSchema),
});

export const relatedSchema: Schema<Related> = openRecord({
  id: text,
  type: types("Related"),
  inLanguage: v.optional(language),
  version: v.optional(text),
});

export const resultSchema: Schema<Result> = openRecord({
  type: types("Result"),
  achievedLevel: v.optional(text),
  alignment: v.optional(many(ref(() => alignmentSchema))),
  resultDescription: v.optional(text),
  status: v.optional(v.picklist(RESULT_STATUS_TYPES)),
  value: v.optional(text),
});

export const resultDescriptionSchema: Schema<ResultDescription> = openRecord({
  id: text,
  type: types("ResultDescription"),
  alignment: v.optional(many(ref(() => alignmentSchema))),
  allowedValue: v.optional(many(text)),
  name: text,
  requiredLevel: v.optional(text),
  requiredValue: v.optional(text),
  resultType: openEnumeration(RESULT_TYPES, "a result type"),
  rubricCriterionLevel: v.optional(many(ref(() => rubricCriterionLevelSchema))),
  valueMax: v.optional(text),
  valueMin: v.optional(text),
});

export const rubricCriterionLevelSchema: Schema<RubricCriterionLevel> = openRecord({
  id: text,
  type: types("RubricCriterionLevel"),
  alignment: v.optional(many(ref(() => alignmentSchema))),
  description: v.optional(text),
  level: v.optional(text),
  name: text,
  points: v.optional(text),
});

export const verifiableCredentialSchema: Schema<VerifiableCredential> = openRecord({
  "@context": contextSchema([CONTEXTS.credentialsV2]),
  id: v.optional(text),
  type: types("VerifiableCredential"),
  issuer: ref(() => profileRefSchema),
  validFrom: dateTimeSchema,
  validUntil: v.optional(dateTimeSchema),
  credentialSubject: ref(() => credentialSubjectSchema),
  proof: v.optional(many(ref(() => proofSchema))),
  credentialSchema: v.optional(many(ref(() => credentialSchemaSchema))),
  credentialStatus: v.optional(ref(() => credentialStatusSchema)),
  refreshService: v.optional(ref(() => refreshServiceSchema)),
  termsOfUse: v.optional(many(ref(() => termsOfUseSchema))),
  evidence: v.optional(many(ref(() => evidenceSchema))),
});

export const credentialSchemaSchema: Schema<CredentialSchema> = openRecord({
  id: text,
  type: text,
});

export const credentialStatusSchema: Schema<CredentialStatus> = openRecord({
  id: v.optional(text),
  type: text,
});

export const credentialSubjectSchema: Schema<CredentialSubject> = openRecord({
  id: v.optional(text),
});

export const proofSchema: Schema<Proof> = openRecord({
  type: text,
  created: v.optional(dateTimeSchema),
  cryptosuite: v.optional(text),
  challenge: v.optional(text),
  domain: v.optional(text),
  nonce: v.optional(text),
  proofPurpose: v.optional(text),
  proofValue: v.optional(text),
  verificationMethod: v.optional(text),
});

export const refreshServiceSchema: Schema<RefreshService> = openRecord({
  id: text,
  type: text,
});

export const termsOfUseSchema: Schema<TermsOfUse> = openRecord({
  id: v.optional(text),
  type: text,
});
