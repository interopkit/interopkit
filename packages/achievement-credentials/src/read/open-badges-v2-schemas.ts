/**
 * The schemas that read the classes of Open Badges 2.0, after the aliases of its context are replaced by their terms. The
 * properties, the ones a class requires and the forms of their values follow the vocabulary of Open Badges 2.0 and the class
 * validators of the validator of 1EdTech.
 *
 * @module
 */

import {
  guardSchema,
  isRecord,
  jsonObjectSchema,
  languageTagSchema,
  openRecord,
  type Schema,
} from "@interopkit/core/checks";
import * as v from "valibot";
import type {
  AlignmentObjectV2,
  AssertionV2,
  BadgeClassV2,
  ContextEntry,
  ContextV2,
  CriteriaV2,
  CryptographicKeyV2,
  EndorsementClaimV2,
  EndorsementV2,
  EvidenceV2,
  IdentityObjectV2,
  ImageV2,
  ProfileV2,
  RelatedV2,
  RevocationListV2,
  RevokedAssertionV2,
  VerificationObjectV2,
} from "../model/index.js";
import { CONTEXTS, IDENTITY_TYPES_V2, VERIFICATION_TYPES_V2 } from "../model/index.js";
import {
  dateTimeV2,
  emailV2,
  hostNameV2,
  imageAddressV2,
  iriV2,
  propertyTermV2,
  telephoneV2,
  typeTermV2,
  urlV2,
} from "./formats-v2.js";
import { many, ref, text, typesOf } from "./primitives.js";

/** An object that the reader reads as a document of its own: a BadgeClass or a Profile that a document embeds. */
export type EmbeddedDocument = Readonly<Record<string, unknown>>;

/** An assertion as a document holds it: its BadgeClass named by its IRI, or embedded. */
export interface AssertionDocumentV2 extends Omit<AssertionV2, "badge"> {
  /** The IRI of the BadgeClass, or the BadgeClass. */
  readonly badge: string | EmbeddedDocument;
}

/** A BadgeClass as a document holds it: the Profile of its issuer named by its IRI, or embedded. */
export interface BadgeClassDocumentV2 extends Omit<BadgeClassV2, "issuer"> {
  /** The IRI of the Profile of the issuer, or the Profile. */
  readonly issuer: string | EmbeddedDocument;
}

/** An embedded document, which the reader checks as a document of its own. */
export const embeddedDocument: Schema<EmbeddedDocument> = guardSchema(isRecord, "an object");

/** A context in a list: the address of a context, or a context that the document holds. */
const contextEntry: Schema<ContextEntry> = v.lazy((input) => (typeof input === "string" ? text : jsonObjectSchema));

/** The context of a document of Open Badges 2.0: the address of the context of 2.0, or a list of contexts that holds it. */
const contextV2: Schema<ContextV2> = v.lazy((input) =>
  typeof input === "string"
    ? v.literal(CONTEXTS.openBadgesV2)
    : v.pipe(
        v.array(contextEntry),
        v.rawTransform(({ dataset, addIssue, NEVER }) => {
          if (dataset.value.includes(CONTEXTS.openBadgesV2)) return dataset.value;
          addIssue({ message: `expected the contexts to hold ${CONTEXTS.openBadgesV2}` });
          return NEVER;
        }),
      ),
);

/**
 * The schema of a class of Open Badges 2.0: an open record that may name the context of Open Badges 2.0, alone or with others.
 *
 * @param entries - The schemas of the properties of the class.
 */
function documentV2<const TEntries extends v.ObjectEntries>(entries: TEntries) {
  return openRecord({ "@context": v.optional(contextV2), ...entries });
}

/**
 * The schema of a property whose value is an IRI or an embedded document: a string is read as the IRI, anything else as the
 * document.
 */
function iriOr<TOutput>(address: Schema<string>, document: Schema<TOutput>): Schema<string | TOutput> {
  return v.lazy((input) => (typeof input === "string" ? address : document));
}

/** The `type` of a class, a list of terms that the context expands to IRIs, which includes the class when one is given. */
function typesV2(...required: readonly (string | readonly string[])[]): Schema<readonly string[]> {
  return typesOf(typeTermV2, ...required);
}

/** Text or a number, such as a version. */
const textOrNumber: Schema<string | number> = v.lazy((input) => (typeof input === "number" ? v.number() : text));

/** The `type` of the verification object of an assertion: its types include one way to verify it and not the other. */
const verificationTypes: Schema<readonly string[]> = v.pipe(
  typesV2(VERIFICATION_TYPES_V2),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    if (VERIFICATION_TYPES_V2.filter((name) => dataset.value.includes(name)).length === 1) return dataset.value;
    addIssue({ message: "expected the types to include one of HostedBadge and SignedBadge, not both" });
    return NEVER;
  }),
);

/** The properties that every primary class has: an assertion, a BadgeClass, a profile and an endorsement. */
const PRIMARY_ENTRIES = {
  "@language": v.optional(languageTagSchema),
  version: v.optional(textOrNumber),
  related: v.optional(
    many(
      iriOr(
        urlV2,
        ref(() => relatedV2Schema),
      ),
    ),
  ),
  endorsement: v.optional(
    many(
      iriOr(
        iriV2,
        ref(() => endorsementV2Schema),
      ),
    ),
  ),
};

/** The properties of a verification object, besides its `type`. */
const VERIFICATION_ENTRIES = {
  creator: v.optional(
    iriOr(
      iriV2,
      ref(() => cryptographicKeyV2Schema),
    ),
  ),
  verificationProperty: v.optional(propertyTermV2),
  startsWith: v.optional(many(urlV2)),
  allowedOrigins: v.optional(many(hostNameV2)),
};

/** An image whose address may be a data URI of a PNG or an SVG: the image of a BadgeClass or a profile. */
export const imageV2Schema: Schema<ImageV2> = documentV2({
  id: imageAddressV2,
  type: v.optional(typesV2()),
  caption: v.optional(text),
  author: v.optional(iriV2),
});

/** The image of an assertion, whose address is an HTTP or HTTPS URL: it may not be a data URI. */
export const assertionImageV2Schema: Schema<ImageV2> = documentV2({
  id: urlV2,
  type: v.optional(typesV2()),
  caption: v.optional(text),
  author: v.optional(iriV2),
});

export const identityObjectV2Schema: Schema<IdentityObjectV2> = documentV2({
  identity: text,
  type: v.picklist(IDENTITY_TYPES_V2),
  hashed: v.boolean(),
  salt: v.optional(text),
});

/** The verification object of an assertion or an endorsement: `HostedBadge` or `SignedBadge`. */
export const assertionVerificationV2Schema: Schema<VerificationObjectV2> = documentV2({
  type: verificationTypes,
  ...VERIFICATION_ENTRIES,
});

/** The verification object of a profile: the scope of the hosted assertions of the issuer. */
export const profileVerificationV2Schema: Schema<VerificationObjectV2> = documentV2({
  type: v.optional(typesV2()),
  ...VERIFICATION_ENTRIES,
});

export const cryptographicKeyV2Schema: Schema<CryptographicKeyV2> = documentV2({
  id: v.optional(iriV2),
  type: v.optional(typesV2()),
  owner: v.optional(iriV2),
  publicKeyPem: v.optional(text),
});

export const evidenceV2Schema: Schema<EvidenceV2> = documentV2({
  id: v.optional(iriV2),
  type: v.optional(typesV2()),
  narrative: v.optional(text),
  name: v.optional(text),
  description: v.optional(text),
  genre: v.optional(text),
  audience: v.optional(text),
});

export const criteriaV2Schema: Schema<CriteriaV2> = documentV2({
  id: v.optional(iriV2),
  type: v.optional(typesV2()),
  narrative: v.optional(text),
});

export const alignmentObjectV2Schema: Schema<AlignmentObjectV2> = documentV2({
  type: v.optional(typesV2()),
  targetName: text,
  targetUrl: urlV2,
  targetDescription: v.optional(text),
  targetFramework: v.optional(text),
  targetCode: v.optional(text),
});

export const relatedV2Schema: Schema<RelatedV2> = documentV2({
  id: iriV2,
  "@language": v.optional(languageTagSchema),
  version: v.optional(textOrNumber),
});

export const endorsementClaimV2Schema: Schema<EndorsementClaimV2> = documentV2({
  id: iriV2,
  endorsementComment: v.optional(text),
});

export const assertionV2Schema: Schema<AssertionDocumentV2> = documentV2({
  id: iriV2,
  type: typesV2("Assertion"),
  recipient: ref(() => identityObjectV2Schema),
  badge: iriOr(iriV2, embeddedDocument),
  verification: ref(() => assertionVerificationV2Schema),
  issuedOn: dateTimeV2,
  image: v.optional(
    iriOr(
      urlV2,
      ref(() => assertionImageV2Schema),
    ),
  ),
  evidence: v.optional(
    many(
      iriOr(
        urlV2,
        ref(() => evidenceV2Schema),
      ),
    ),
  ),
  narrative: v.optional(text),
  expires: v.optional(dateTimeV2),
  revoked: v.optional(v.boolean()),
  revocationReason: v.optional(text),
  uid: v.optional(text),
  ...PRIMARY_ENTRIES,
});

export const badgeClassV2Schema: Schema<BadgeClassDocumentV2> = documentV2({
  id: iriV2,
  type: typesV2("BadgeClass"),
  name: text,
  description: text,
  image: iriOr(
    imageAddressV2,
    ref(() => imageV2Schema),
  ),
  criteria: iriOr(
    urlV2,
    ref(() => criteriaV2Schema),
  ),
  issuer: iriOr(iriV2, embeddedDocument),
  alignment: v.optional(many(ref(() => alignmentObjectV2Schema))),
  tags: v.optional(many(text)),
  ...PRIMARY_ENTRIES,
});

/** A profile as an issuer reads it, with the name, address and email that an issuer must have. */
export const profileV2Schema: Schema<ProfileV2> = documentV2({
  id: iriV2,
  type: typesV2(["Issuer", "Profile"]),
  name: text,
  url: urlV2,
  email: emailV2,
  telephone: v.optional(telephoneV2),
  description: v.optional(text),
  image: v.optional(
    iriOr(
      imageAddressV2,
      ref(() => imageV2Schema),
    ),
  ),
  publicKey: v.optional(
    many(
      iriOr(
        iriV2,
        ref(() => cryptographicKeyV2Schema),
      ),
    ),
  ),
  verification: v.optional(ref(() => profileVerificationV2Schema)),
  revocationList: v.optional(iriV2),
  ...PRIMARY_ENTRIES,
});

export const endorsementV2Schema: Schema<EndorsementV2> = documentV2({
  id: iriV2,
  type: typesV2("Endorsement"),
  claim: ref(() => endorsementClaimV2Schema),
  issuer: iriOr(
    iriV2,
    ref(() => profileV2Schema),
  ),
  issuedOn: dateTimeV2,
  verification: ref(() => assertionVerificationV2Schema),
  revoked: v.optional(v.boolean()),
  revocationReason: v.optional(text),
  ...PRIMARY_ENTRIES,
});

export const revokedAssertionV2Schema: Schema<RevokedAssertionV2> = documentV2({
  id: v.optional(iriV2),
  uid: v.optional(text),
  type: v.optional(typesV2()),
  revoked: v.optional(v.boolean()),
  revocationReason: v.optional(text),
});

export const revocationListV2Schema: Schema<RevocationListV2> = documentV2({
  id: v.optional(iriV2),
  type: typesV2("RevocationList"),
  issuer: v.optional(iriV2),
  revokedAssertions: many(
    iriOr(
      iriV2,
      ref(() => revokedAssertionV2Schema),
    ),
  ),
});
