/**
 * The classes of Open Badges 2.0, which the package reads and verifies and never writes. Each is a document under the context
 * of Open Badges 2.0, held as the compacted form writes it: the aliases of the context (`verify`, `hosted`, `signed`) read as
 * the terms they stand for, and a property that may have several values as a list. A document that names its context keeps
 * it, and a document embedded in another needs none.
 *
 * @module
 */

import type { ContextEntry } from "./context.js";

/**
 * The context of a document of Open Badges 2.0: the address of the context of 2.0, or a list that holds it among other contexts,
 * such as the context of an extension.
 */
export type ContextV2 = "https://w3id.org/openbadges/v2" | readonly ContextEntry[];

/** The kinds of identity that the recipient of a 2.0 assertion may have: the properties that identify a profile. */
export const IDENTITY_TYPES_V2 = ["id", "email", "url", "telephone"] as const;

/** A term of `IDENTITY_TYPES_V2`. */
export type IdentityTypeV2 = (typeof IDENTITY_TYPES_V2)[number];

/** The ways to verify one assertion: by its address, or by a signature. */
export const VERIFICATION_TYPES_V2 = ["HostedBadge", "SignedBadge"] as const;

/** A term of `VERIFICATION_TYPES_V2`. */
export type VerificationTypeV2 = (typeof VERIFICATION_TYPES_V2)[number];

/**
 * An Open Badges 2.0 assertion with its BadgeClass and the Profile of its issuer, linked by their addresses: what the readers
 * and the verifier return for a 2.0 badge.
 */
export interface BadgeAssertionV2 {
  /** Tells a 2.0 badge apart from a credential of Open Badges 3.0 or CLR 2.0. */
  readonly version: "2.0";
  /** The assertion, whose `badge` is the `id` of `badge`. */
  readonly assertion: AssertionV2;
  /** The BadgeClass of the assertion, whose `issuer` is the `id` of `issuer`. */
  readonly badge: BadgeClassV2;
  /** The Profile of the issuer of the BadgeClass. */
  readonly issuer: ProfileV2;
}

/** An awarded badge: the achievement of one earner (OB 2.0, Assertion). */
export interface AssertionV2 {
  /** The context of Open Badges 2.0, alone or among others, when the document names it. */
  readonly "@context"?: ContextV2;
  /** Unique IRI for the Assertion: its address when it is hosted, or a `urn:uuid` when it is signed. */
  readonly id: string;
  /** The types, which include `Assertion`. */
  readonly type: readonly string[];
  /** The recipient of the achievement. */
  readonly recipient: IdentityObjectV2;
  /** The IRI of the BadgeClass that describes the badge being awarded. */
  readonly badge: string;
  /** Instructions for third parties to verify this assertion. */
  readonly verification: VerificationObjectV2;
  /** Timestamp of when the achievement was awarded: ISO 8601 with a time zone. */
  readonly issuedOn: string;
  /** An image of this user's achievement: its IRI, or a document that describes it. */
  readonly image?: string | ImageV2;
  /** The work that the recipient did to earn the achievement: IRIs, or documents that describe it. */
  readonly evidence?: readonly (string | EvidenceV2)[];
  /** A narrative that connects multiple pieces of evidence, in text or Markdown. */
  readonly narrative?: string;
  /** When the badge should no longer be considered valid. */
  readonly expires?: string;
  /** Whether the issuer revoked the assertion. */
  readonly revoked?: boolean;
  /** The published reason for revocation, if revoked. */
  readonly revocationReason?: string;
  /** The identifier of a badge of a version before 1.1, which `id` replaced. */
  readonly uid?: string;
  /** The language of the assertion, as a language tag. */
  readonly "@language"?: string;
  /** The version identifier for the present edition of the entity. */
  readonly version?: string | number;
  /** Other editions of the same entity: IRIs, or documents with their own `id`. */
  readonly related?: readonly (string | RelatedV2)[];
  /** Claims made about this entity: IRIs of endorsements, or endorsements. */
  readonly endorsement?: readonly (string | EndorsementV2)[];
}

/** The accomplishment that a badge recognizes, which many assertions may award (OB 2.0, BadgeClass). */
export interface BadgeClassV2 {
  /** The context of Open Badges 2.0, alone or among others, when the document names it. */
  readonly "@context"?: ContextV2;
  /** Unique IRI for the BadgeClass. */
  readonly id: string;
  /** The types, which include `BadgeClass`. */
  readonly type: readonly string[];
  /** The name of the achievement. */
  readonly name: string;
  /** A short description of the achievement. */
  readonly description: string;
  /** An image of the achievement, PNG or SVG: its address or data URI, or a document that describes it. */
  readonly image: string | ImageV2;
  /** How to earn the achievement: the URI of a page, or an embedded document. */
  readonly criteria: string | CriteriaV2;
  /** The IRI of the Profile of the issuer. */
  readonly issuer: string;
  /** The objectives or educational standards that the badge aligns to. */
  readonly alignment?: readonly AlignmentObjectV2[];
  /** Tags that describe the type of achievement. */
  readonly tags?: readonly string[];
  /** The language of the BadgeClass, as a language tag. */
  readonly "@language"?: string;
  /** The version identifier for the present edition of the entity. */
  readonly version?: string | number;
  /** Other editions of the same entity: IRIs, or documents with their own `id`. */
  readonly related?: readonly (string | RelatedV2)[];
  /** Claims made about this entity: IRIs of endorsements, or endorsements. */
  readonly endorsement?: readonly (string | EndorsementV2)[];
}

/** The individual, entity or organization that issues badges (OB 2.0, Profile), with what an issuer must have. */
export interface ProfileV2 {
  /** The context of Open Badges 2.0, alone or among others, when the document names it. */
  readonly "@context"?: ContextV2;
  /** Unique IRI for the Profile. */
  readonly id: string;
  /** The types, which include `Issuer` or `Profile`. */
  readonly type: readonly string[];
  /** The name of the entity or organization. */
  readonly name: string;
  /** The homepage or social media profile of the entity. */
  readonly url: string;
  /** Contact address for the individual or organization. */
  readonly email: string;
  /** A phone number for the entity, in E.164. */
  readonly telephone?: string;
  /** A short description of the issuer entity or organization. */
  readonly description?: string;
  /** An image of the issuer, PNG or SVG: its address or data URI, or a document that describes it. */
  readonly image?: string | ImageV2;
  /** The keys that the issuer signs assertions with: IRIs of CryptographicKey documents, or the documents. */
  readonly publicKey?: readonly (string | CryptographicKeyV2)[];
  /** Instructions for how to verify the assertions that the profile publishes. */
  readonly verification?: VerificationObjectV2;
  /** The HTTP URI of the RevocationList of the signed badges of the issuer. */
  readonly revocationList?: string;
  /** The language of the profile, as a language tag. */
  readonly "@language"?: string;
  /** The version identifier for the present edition of the entity. */
  readonly version?: string | number;
  /** Other editions of the same entity: IRIs, or documents with their own `id`. */
  readonly related?: readonly (string | RelatedV2)[];
  /** Claims made about this entity: IRIs of endorsements, or endorsements. */
  readonly endorsement?: readonly (string | EndorsementV2)[];
}

/** The recipient of a 2.0 assertion: `identity` is the plain value, or a `sha256$` or `md5$` hash of it (OB 2.0, IdentityObject). */
export interface IdentityObjectV2 {
  /** The plain value, or the hash of it. */
  readonly identity: string;
  /** The property of a profile that identifies the recipient, such as `email`. */
  readonly type: IdentityTypeV2;
  /** Whether `identity` is a hash. */
  readonly hashed: boolean;
  /** The text appended to the value before it was hashed. */
  readonly salt?: string;
}

/**
 * How to verify an assertion: in an assertion, by its address (`HostedBadge`) or by a signature (`SignedBadge`); in a profile,
 * the scope that the hosted assertions of the issuer must be in (OB 2.0, VerificationObject).
 */
export interface VerificationObjectV2 {
  /** The types: one of `VERIFICATION_TYPES_V2` in an assertion, `VerificationObject` or none in a profile. */
  readonly type?: readonly string[];
  /** The key that signed the assertion: the IRI of a CryptographicKey, or the document. */
  readonly creator?: string | CryptographicKeyV2;
  /** The property that must be within the scope; only `id` is supported. */
  readonly verificationProperty?: string;
  /** The URIs that the `id` of a hosted assertion of the issuer must start with, one of them. */
  readonly startsWith?: readonly string[];
  /** The host names that a hosted assertion of the issuer may be on. */
  readonly allowedOrigins?: readonly string[];
}

/** A key used for signing Open Badges documents (OB 2.0, CryptographicKey). */
export interface CryptographicKeyV2 {
  /** The context of Open Badges 2.0, alone or among others, when the document names it. */
  readonly "@context"?: ContextV2;
  /** The identifier for the key. */
  readonly id?: string;
  /** The types; `CryptographicKey` when present. */
  readonly type?: readonly string[];
  /** The IRI of the Profile that owns this key. */
  readonly owner?: string;
  /** The public key in PEM. */
  readonly publicKeyPem?: string;
}

/** The assertions and endorsements that an issuer revoked (OB 2.0, RevocationList). */
export interface RevocationListV2 {
  /** The context of Open Badges 2.0, alone or among others, when the document names it. */
  readonly "@context"?: ContextV2;
  /** The id of the RevocationList. */
  readonly id?: string;
  /** The types, which include `RevocationList`. */
  readonly type: readonly string[];
  /** The id of the Issuer. */
  readonly issuer?: string;
  /** The revoked assertions: their IRIs, or entries that name them by `id` or by `uid`. */
  readonly revokedAssertions: readonly (string | RevokedAssertionV2)[];
}

/** An entry of a RevocationList: an assertion named by its `id`, or by the `uid` of a badge before 1.1. */
export interface RevokedAssertionV2 {
  /** The id of the revoked Assertion or Endorsement. */
  readonly id?: string;
  /** The identifier of a badge before 1.1. */
  readonly uid?: string;
  /** The types; `Assertion` when absent. */
  readonly type?: readonly string[];
  /**
   * Whether the assertion is revoked, as the entry says. Open Badges 2.0 does not define it for an entry: a verifier counts every
   * entry that names an assertion as its revocation, as the validator of 1EdTech does.
   */
  readonly revoked?: boolean;
  /** The published reason for revocation. */
  readonly revocationReason?: string;
}

/** Descriptive metadata about evidence related to the issuance of an assertion (OB 2.0, Evidence). */
export interface EvidenceV2 {
  /** The URI of a webpage presenting evidence of achievement. */
  readonly id?: string;
  /** The types; `Evidence` when absent. */
  readonly type?: readonly string[];
  /** A narrative that describes the evidence and process of achievement, in text or Markdown. */
  readonly narrative?: string;
  /** A descriptive title of the evidence. */
  readonly name?: string;
  /** A longer description of the evidence. */
  readonly description?: string;
  /** The type of evidence, such as Poetry, Prose or Film. */
  readonly genre?: string;
  /** A description of the intended audience for a piece of evidence. */
  readonly audience?: string;
}

/** Metadata about an image that represents an assertion, a BadgeClass or a profile (OB 2.0, Image). */
export interface ImageV2 {
  /** The URI or the data URI of the image. */
  readonly id: string;
  /** The types; `schema:ImageObject` when absent. */
  readonly type?: readonly string[];
  /** The caption for the image. */
  readonly caption?: string;
  /** The IRI of the Profile of the author of the image. */
  readonly author?: string;
}

/** What it takes to earn the badge of a BadgeClass: a page, a narrative, or both (OB 2.0, Criteria). */
export interface CriteriaV2 {
  /** The URI of a webpage that describes the criteria. */
  readonly id?: string;
  /** The types; `Criteria` when absent. */
  readonly type?: readonly string[];
  /** A narrative of what is needed to earn the badge, in text or Markdown. */
  readonly narrative?: string;
}

/** An objective or educational standard that a badge aligns to, with the IRIs of schema.org (OB 2.0, AlignmentObject). */
export interface AlignmentObjectV2 {
  /** The types; `AlignmentObject` when absent. */
  readonly type?: readonly string[];
  /** Name of the alignment. */
  readonly targetName: string;
  /** URL linking to the official description of the alignment target. */
  readonly targetUrl: string;
  /** Short description of the alignment target. */
  readonly targetDescription?: string;
  /** Name of the framework of the alignment target. */
  readonly targetFramework?: string;
  /** A locally unique string identifier of the alignment target within its framework. */
  readonly targetCode?: string;
}

/** A claim that an issuer makes about a profile, a BadgeClass or an assertion (OB 2.0, Endorsement). */
export interface EndorsementV2 {
  /** The context of Open Badges 2.0, alone or among others, when the document names it. */
  readonly "@context"?: ContextV2;
  /** Unique IRI for the Endorsement. */
  readonly id: string;
  /** The types, which include `Endorsement`. */
  readonly type: readonly string[];
  /** The endorsed entity, identified by its `id`, and what the endorser claims about it. */
  readonly claim: EndorsementClaimV2;
  /** The profile of the issuer of the endorsement: its IRI, or the document. */
  readonly issuer: string | ProfileV2;
  /** Timestamp of when the endorsement was published. */
  readonly issuedOn: string;
  /** Instructions for third parties to verify this endorsement. */
  readonly verification: VerificationObjectV2;
  /** Whether the issuer revoked the endorsement. */
  readonly revoked?: boolean;
  /** The published reason for revocation, if revoked. */
  readonly revocationReason?: string;
  /** The language of the endorsement, as a language tag. */
  readonly "@language"?: string;
  /** The version identifier for the present edition of the entity. */
  readonly version?: string | number;
  /** Other editions of the same entity: IRIs, or documents with their own `id`. */
  readonly related?: readonly (string | RelatedV2)[];
  /** Claims made about this entity: IRIs of endorsements, or endorsements. */
  readonly endorsement?: readonly (string | EndorsementV2)[];
}

/** The entity that an endorsement is about, and what the endorser claims about it. */
export interface EndorsementClaimV2 {
  /** The IRI of the endorsed entity. */
  readonly id: string;
  /** The endorser's comment about the quality or fitness of the endorsed entity, in text or Markdown. */
  readonly endorsementComment?: string;
}

/** Another edition of an entity, such as a version of a BadgeClass in another language. */
export interface RelatedV2 {
  /** The IRI of the other edition. */
  readonly id: string;
  /** Its language, as a language tag. */
  readonly "@language"?: string;
  /** Its version identifier. */
  readonly version?: string | number;
}
