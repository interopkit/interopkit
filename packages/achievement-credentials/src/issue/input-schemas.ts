import { absoluteUriSchema, dateTimeSchema, finiteSchema, type Schema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type { AchievementCredential } from "../model/index.js";
import { CLASS_SCHEMAS } from "../read/internal.js";
import type { AchievementCredentialInput, ClrCredentialInput, EndorsementCredentialInput } from "./inputs.js";

const text = v.string();
const optionalText = v.optional(text);
const optionalDateTime = v.optional(dateTimeSchema);

/** The AchievementCredential that a builder is asked for. The classes it holds are read by the schemas of their own. */
export const achievementCredentialInputSchema: Schema<AchievementCredentialInput> = strictRecord({
  id: absoluteUriSchema,
  issuer: CLASS_SCHEMAS.profileSchema,
  validFrom: dateTimeSchema,
  validUntil: optionalDateTime,
  name: text,
  description: optionalText,
  image: v.optional(CLASS_SCHEMAS.imageSchema),
  subject: strictRecord({
    id: optionalText,
    identifier: v.optional(v.array(CLASS_SCHEMAS.identityObjectSchema)),
    result: v.optional(v.array(CLASS_SCHEMAS.resultSchema)),
    activityStartDate: optionalDateTime,
    activityEndDate: optionalDateTime,
    creditsEarned: v.optional(finiteSchema),
    role: optionalText,
    term: optionalText,
  }),
  achievement: CLASS_SCHEMAS.achievementSchema,
  awardedDate: optionalDateTime,
  evidence: v.optional(v.array(CLASS_SCHEMAS.evidenceSchema)),
  endorsement: v.optional(v.array(CLASS_SCHEMAS.endorsementCredentialSchema)),
  endorsementJwt: v.optional(v.array(text)),
  credentialStatus: v.optional(CLASS_SCHEMAS.credentialStatusSchema),
  refreshService: v.optional(CLASS_SCHEMAS.refreshServiceSchema),
  termsOfUse: v.optional(v.array(CLASS_SCHEMAS.termsOfUseSchema)),
});

/** The EndorsementCredential that a builder is asked for. */
export const endorsementCredentialInputSchema: Schema<EndorsementCredentialInput> = strictRecord({
  id: absoluteUriSchema,
  issuer: CLASS_SCHEMAS.profileSchema,
  validFrom: dateTimeSchema,
  name: text,
  endorses: text,
  comment: optionalText,
  validUntil: optionalDateTime,
  credentialStatus: v.optional(CLASS_SCHEMAS.credentialStatusSchema),
});

const objects = v.pipe(v.array(CLASS_SCHEMAS.achievementCredentialSchema), v.minLength(1));
const signed = v.pipe(v.array(text), v.minLength(1));

/** The ClrCredential, or the payload of one, that a builder is asked for: the first credential says which. */
export const clrCredentialInputSchema: Schema<ClrCredentialInput<AchievementCredential | string>> = strictRecord({
  id: absoluteUriSchema,
  issuer: CLASS_SCHEMAS.profileSchema,
  validFrom: dateTimeSchema,
  validUntil: optionalDateTime,
  name: text,
  subject: strictRecord({
    id: optionalText,
    identifier: v.optional(v.array(CLASS_SCHEMAS.identityObjectSchema)),
  }),
  credentials: v.lazy((input) => (Array.isArray(input) && typeof input[0] === "string" ? signed : objects)),
  achievements: v.optional(v.array(CLASS_SCHEMAS.achievementSchema)),
  associations: v.optional(v.array(CLASS_SCHEMAS.associationSchema)),
  partial: v.optional(v.boolean()),
  credentialStatus: v.optional(CLASS_SCHEMAS.credentialStatusSchema),
  refreshService: v.optional(CLASS_SCHEMAS.refreshServiceSchema),
});
