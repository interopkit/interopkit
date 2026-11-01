/**
 * The classes that Open Badges 3.0 and CLR 2.0 share (OB B.1, CLR B.4), under the Verifiable Credentials Data Model 2.0.
 *
 * @module
 */

import type { ContextEntry } from "./context.js";
import type {
  AchievementType,
  AlignmentTargetType,
  ExtensionTerm,
  IdentifierType,
  ResultStatusType,
  ResultType,
} from "./vocabularies.js";

/** A collection of information about the accomplishment recognized by the Assertion. */
export interface Achievement {
  /** Unique URI for the Achievement. */
  readonly id: string;
  /** The types, which include `Achievement`. */
  readonly type: readonly string[];
  /** The nodes of educational frameworks that it aligns to. */
  readonly alignment?: readonly Alignment[];
  /** The type of achievement. */
  readonly achievementType?: AchievementType | ExtensionTerm;
  /** The person or organization that created it. */
  readonly creator?: Profile;
  /** Credit hours associated with this entity, or credit hours possible. */
  readonly creditsAvailable?: number;
  /** The criteria to earn it. */
  readonly criteria: Criteria;
  /** A short description of the achievement. */
  readonly description: string;
  /** Endorsements, as embedded credentials. */
  readonly endorsement?: readonly EndorsementCredential[];
  /** Allows endorsers to make specific claims about the Achievement. */
  readonly endorsementJwt?: readonly string[];
  /** Category, subject, area of study, discipline, or general branch of knowledge. */
  readonly fieldOfStudy?: string;
  /** The code, generally human readable, associated with an achievement. */
  readonly humanCode?: string;
  /** An image that represents it. */
  readonly image?: Image;
  /** The language of the achievement. */
  readonly inLanguage?: string;
  /** The name of the achievement. */
  readonly name: string;
  /** Other identifiers of it. */
  readonly otherIdentifier?: readonly IdentifierEntry[];
  /** Related achievements. */
  readonly related?: readonly Related[];
  /** The result descriptions that define the possible results. */
  readonly resultDescription?: readonly ResultDescription[];
  /** Name given to the focus, concentration, or specific area of study defined in the achievement. */
  readonly specialization?: string;
  /** One or more short, human-friendly, searchable, keywords that describe the type of achievement. */
  readonly tag?: readonly string[];
  /** The version property allows issuers to set a version string for an Achievement. */
  readonly version?: string;
}

/** An achievement that was awarded to one earner, as a verifiable credential (OB B.1.2). */
export interface AchievementCredential {
  /** The JSON-LD contexts, in order: the Verifiable Credentials context, then the Open Badges context. */
  readonly "@context": readonly ContextEntry[];
  /** Unambiguous reference to the credential. */
  readonly id: string;
  /** The types, which include `VerifiableCredential` and `AchievementCredential` or `OpenBadgeCredential`. */
  readonly type: readonly string[];
  /** The name of the credential for display purposes in wallets. */
  readonly name?: string;
  /** The short description of the credential for display purposes in wallets. */
  readonly description?: string;
  /** An image that represents it. */
  readonly image?: Image;
  /** Timestamp of when the credential was awarded. */
  readonly awardedDate?: string;
  /** The subject, and what the credential asserts about it. */
  readonly credentialSubject: AchievementSubject;
  /** Endorsements, as embedded credentials. */
  readonly endorsement?: readonly EndorsementCredential[];
  /**
   * Allows endorsers to make specific claims about the credential, and the achievement and profiles in the
   * credential.
   */
  readonly endorsementJwt?: readonly string[];
  /** The issuer: its profile. */
  readonly issuer: ProfileRef;
  /** Timestamp of when the credential becomes valid. */
  readonly validFrom: string;
  /**
   * If the credential has some notion of validity period, this indicates a timestamp when a credential should no
   * longer be considered valid.
   */
  readonly validUntil?: string;
  /** The proofs that secure the credential. */
  readonly proof?: readonly Proof[];
  /** The schemas that the credential conforms to. */
  readonly credentialSchema?: readonly CredentialSchema[];
  /** How a verifier learns whether the credential is revoked or suspended. */
  readonly credentialStatus?: CredentialStatus;
  /** Where a newer copy of the credential can be fetched. */
  readonly refreshService?: RefreshService;
  /** The terms of use that apply to the credential. */
  readonly termsOfUse?: readonly TermsOfUse[];
  /** Evidence that supports the claims. */
  readonly evidence?: readonly Evidence[];
}

/** The recipient of an achievement and the achievement that they earned (OB B.1.3). */
export interface AchievementSubject {
  /** An identifier for the Credential Subject. */
  readonly id?: string;
  /** The types, which include `AchievementSubject`. */
  readonly type: readonly string[];
  /** The datetime the activity ended. */
  readonly activityEndDate?: string;
  /** The datetime the activity started. */
  readonly activityStartDate?: string;
  /** The number of credits earned, generally in semester or quarter credit hours. */
  readonly creditsEarned?: number;
  /** The achievement that was earned. */
  readonly achievement: Achievement;
  /** Identifiers of the recipient. */
  readonly identifier?: readonly IdentityObject[];
  /** An image that represents it. */
  readonly image?: Image;
  /** The license number that was issued with this credential. */
  readonly licenseNumber?: string;
  /** A narrative that connects multiple pieces of evidence. */
  readonly narrative?: string;
  /** The results that were achieved. */
  readonly result?: readonly Result[];
  /**
   * Role, position, or title of the learner when demonstrating or performing the achievement or evidence of learning
   * being asserted.
   */
  readonly role?: string;
  /** The issuing organization or person, if not the issuer of the credential. */
  readonly source?: Profile;
  /** The academic term in which this assertion was achieved. */
  readonly term?: string;
}

/** An address for the described entity. */
export interface Address {
  /** The types, which include `Address`. */
  readonly type: readonly string[];
  /** A country. */
  readonly addressCountry?: string;
  /** A country code. */
  readonly addressCountryCode?: string;
  /** A region within the country. */
  readonly addressRegion?: string;
  /** A locality within the region. */
  readonly addressLocality?: string;
  /** A street address within the locality. */
  readonly streetAddress?: string;
  /** A post office box number for PO box addresses. */
  readonly postOfficeBoxNumber?: string;
  /** A postal code. */
  readonly postalCode?: string;
  /** The geographic coordinates. */
  readonly geo?: GeoCoordinates;
}

/** Describes an alignment between an achievement and a node in an educational framework. */
export interface Alignment {
  /** The types, which include `Alignment`. */
  readonly type: readonly string[];
  /**
   * If applicable, a locally unique string identifier that identifies the alignment target within its framework
   * and/or targetUrl.
   */
  readonly targetCode?: string;
  /** Short description of the alignment target. */
  readonly targetDescription?: string;
  /** Name of the alignment. */
  readonly targetName: string;
  /** Name of the framework the alignment target. */
  readonly targetFramework?: string;
  /** The type of the alignment target node. */
  readonly targetType?: AlignmentTargetType | ExtensionTerm;
  /**
   * URL linking to the official description of the alignment target, for example an individual standard within an
   * educational framework.
   */
  readonly targetUrl: string;
}

/**
 * Descriptive metadata about the achievements necessary to be recognized with an assertion of a particular
 * achievement.
 */
export interface Criteria {
  /** The URI of a webpage that describes in a human-readable format the criteria for the achievement. */
  readonly id?: string;
  /** A narrative of what is needed to earn the achievement. */
  readonly narrative?: string;
}

/** A verifiable credential that asserts a claim about an entity. */
export interface EndorsementCredential {
  /** The JSON-LD contexts, in order: the Verifiable Credentials context, then the Open Badges context. */
  readonly "@context": readonly ContextEntry[];
  /** The types, which include `VerifiableCredential` and `EndorsementCredential`. */
  readonly type: readonly string[];
  /** Unambiguous reference to the credential. */
  readonly id: string;
  /** The name of the credential for display purposes in wallets. */
  readonly name: string;
  /** The short description of the credential for display purposes in wallets. */
  readonly description?: string;
  /** The subject, and what the credential asserts about it. */
  readonly credentialSubject: EndorsementSubject;
  /** Timestamp of when the credential was awarded. */
  readonly awardedDate?: string;
  /** The issuer: its profile. */
  readonly issuer: ProfileRef;
  /** Timestamp of when the credential becomes valid. */
  readonly validFrom: string;
  /**
   * If the credential has some notion of validity period, this indicates a timestamp when a credential should no
   * longer be considered valid.
   */
  readonly validUntil?: string;
  /** The proofs that secure the credential. */
  readonly proof?: readonly Proof[];
  /** The schemas that the credential conforms to. */
  readonly credentialSchema?: readonly CredentialSchema[];
  /** How a verifier learns whether the credential is revoked or suspended. */
  readonly credentialStatus?: CredentialStatus;
  /** Where a newer copy of the credential can be fetched. */
  readonly refreshService?: RefreshService;
  /** The terms of use that apply to the credential. */
  readonly termsOfUse?: readonly TermsOfUse[];
  /** Evidence that supports the claims. */
  readonly evidence?: readonly Evidence[];
}

/** A collection of information about the subject of the endorsement. */
export interface EndorsementSubject {
  /** The identifier of the individual, entity, organization, assertion, or achievement that is endorsed. */
  readonly id: string;
  /** The types, which include `EndorsementSubject`. */
  readonly type: readonly string[];
  /** Allows endorsers to make a simple claim in writing about the entity. */
  readonly endorsementComment?: string;
}

/** Descriptive metadata about evidence related to the achievement assertion. */
export interface Evidence {
  /** The URL of a webpage presenting evidence of achievement or the evidence encoded as a Data URI. */
  readonly id?: string;
  /** The types, which include `Evidence`. */
  readonly type: readonly string[];
  /** A narrative that describes the evidence and process of achievement that led to an assertion. */
  readonly narrative?: string;
  /** A descriptive title of the evidence. */
  readonly name?: string;
  /** A longer description of the evidence. */
  readonly description?: string;
  /** A string that describes the type of evidence. */
  readonly genre?: string;
  /** A description of the intended audience for a piece of evidence. */
  readonly audience?: string;
}

/** The geographic coordinates of a location. */
export interface GeoCoordinates {
  /** MUST be the IRI 'GeoCoordinates'. */
  readonly type: "GeoCoordinates";
  /** The latitude of the location (WGS 84). */
  readonly latitude: number;
  /** The longitude of the location (WGS 84). */
  readonly longitude: number;
}

/** An identifier of the person or organization that a profile describes, beyond its own (OB B.1.11). */
export interface IdentifierEntry {
  /** MUST be the IRI 'IdentifierEntry'. */
  readonly type: "IdentifierEntry";
  /** An identifier. */
  readonly identifier: string;
  /** The identifier type. */
  readonly identifierType: IdentifierType | ExtensionTerm;
}

/** The identity of the recipient of an achievement, as a hash or as the plain value (OB B.1.12). */
export interface IdentityObject {
  /** MUST be the IRI 'IdentityObject'. */
  readonly type: "IdentityObject";
  /** Whether or not the `identityHash` value is hashed. */
  readonly hashed: boolean;
  /** Either the IdentityHash of the identity or the plaintext value. */
  readonly identityHash: string;
  /** The identity type. */
  readonly identityType: IdentifierType | ExtensionTerm;
  /** If the `identityHash` is hashed, this should contain the string used to salt the hash. */
  readonly salt?: string;
}

/** Metadata about images that represent assertions, achieve or profiles. */
export interface Image {
  /** The URI or Data URI of the image. */
  readonly id: string;
  /** MUST be the IRI 'Image'. */
  readonly type: "Image";
  /** The caption for the image. */
  readonly caption?: string;
}

/** A Profile is a collection of information that describes the entity or organization using Open Badges. */
export interface Profile {
  /** Unique URI for the Issuer/Profile file. */
  readonly id: string;
  /** The types, which include `Profile`. */
  readonly type: readonly string[];
  /** The name of the entity or organization. */
  readonly name?: string;
  /** The homepage or social media profile of the entity, whether individual or institutional. */
  readonly url?: string;
  /** A phone number. */
  readonly phone?: string;
  /** A short description of the issuer entity or organization. */
  readonly description?: string;
  /** Endorsements, as embedded credentials. */
  readonly endorsement?: readonly EndorsementCredential[];
  /** Allows endorsers to make specific claims about the individual or organization represented by this profile. */
  readonly endorsementJwt?: readonly string[];
  /** An image that represents it. */
  readonly image?: Image;
  /** An email address. */
  readonly email?: string;
  /** The address. */
  readonly address?: Address;
  /** Other identifiers of it. */
  readonly otherIdentifier?: readonly IdentifierEntry[];
  /** If the entity is an organization, `official` is the name of an authorized official of the organization. */
  readonly official?: string;
  /** The organization that it belongs to. */
  readonly parentOrg?: Profile;
  /** Family name. */
  readonly familyName?: string;
  /** Given name. */
  readonly givenName?: string;
  /** Additional name. */
  readonly additionalName?: string;
  /** Patronymic name. */
  readonly patronymicName?: string;
  /** Honorific prefix(es) preceding a person's name (e.g. 'Dr', 'Mrs' or 'Mr'). */
  readonly honorificPrefix?: string;
  /** Honorific suffix(es) following a person's name (e.g. 'M.D, PhD'). */
  readonly honorificSuffix?: string;
  /** Family name prefix. */
  readonly familyNamePrefix?: string;
  /** Birthdate of the person. */
  readonly dateOfBirth?: string;
}

/** Identifies a related achievement. */
export interface Related {
  /** The related achievement. */
  readonly id: string;
  /** The types, which include `Related`. */
  readonly type: readonly string[];
  /** The language of the related achievement. */
  readonly inLanguage?: string;
  /** The version of the related achievement. */
  readonly version?: string;
}

/** Describes a result that was achieved. */
export interface Result {
  /** The types, which include `Result`. */
  readonly type: readonly string[];
  /**
   * If the result represents an achieved rubric criterion level (e.g. Mastered), the value is the `id` of the
   * RubricCriterionLevel in linked ResultDescription.
   */
  readonly achievedLevel?: string;
  /** The nodes of educational frameworks that it aligns to. */
  readonly alignment?: readonly Alignment[];
  /** An achievement can have many result descriptions describing possible results. */
  readonly resultDescription?: string;
  /** The status of the achievement. */
  readonly status?: ResultStatusType;
  /** A string representing the result of the performance, or demonstration, of the achievement. */
  readonly value?: string;
}

/** Describes a possible achievement result. */
export interface ResultDescription {
  /** The unique URI for this result description. */
  readonly id: string;
  /** The types, which include `ResultDescription`. */
  readonly type: readonly string[];
  /** The nodes of educational frameworks that it aligns to. */
  readonly alignment?: readonly Alignment[];
  /** An ordered list of allowed values. */
  readonly allowedValue?: readonly string[];
  /** The name of the result. */
  readonly name: string;
  /** The `id` of the rubric criterion level required to pass as determined by the achievement creator. */
  readonly requiredLevel?: string;
  /**
   * A value from `allowedValue` or within the range of `valueMin` to `valueMax` required to pass as determined by the
   * achievement creator.
   */
  readonly requiredValue?: string;
  /** The type of result this description represents. */
  readonly resultType: ResultType | ExtensionTerm;
  /** The levels of a rubric criterion that a result can reach. */
  readonly rubricCriterionLevel?: readonly RubricCriterionLevel[];
  /** The maximum possible `value` that may be asserted in a linked result. */
  readonly valueMax?: string;
  /** The minimum possible `value` that may be asserted in a linked result. */
  readonly valueMin?: string;
}

/** Describes a rubric criterion level. */
export interface RubricCriterionLevel {
  /** The unique URI for this rubric criterion level. */
  readonly id: string;
  /** The types, which include `RubricCriterionLevel`. */
  readonly type: readonly string[];
  /** The nodes of educational frameworks that it aligns to. */
  readonly alignment?: readonly Alignment[];
  /** Description of the rubric criterion level. */
  readonly description?: string;
  /** The rubric performance level in terms of success. */
  readonly level?: string;
  /** The name of the rubric criterion level. */
  readonly name: string;
  /** The points associated with this rubric criterion level. */
  readonly points?: string;
}

/** A Verifiable Credential as defined in the Verifiable Credentials Data Model 2.0. */
export interface VerifiableCredential {
  /** The JSON-LD contexts, in order. */
  readonly "@context": readonly ContextEntry[];
  /** Unambiguous reference to the credential. */
  readonly id?: string;
  /** The types, which include `VerifiableCredential`. */
  readonly type: readonly string[];
  /** The issuer: its profile. */
  readonly issuer: ProfileRef;
  /** Timestamp of when the credential becomes valid. */
  readonly validFrom: string;
  /**
   * If the credential has some notion of validity period, this indicates a timestamp when a credential should no
   * longer be considered valid.
   */
  readonly validUntil?: string;
  /** The subject, and what the credential asserts about it. */
  readonly credentialSubject: CredentialSubject;
  /** The proofs that secure the credential. */
  readonly proof?: readonly Proof[];
  /** The schemas that the credential conforms to. */
  readonly credentialSchema?: readonly CredentialSchema[];
  /** How a verifier learns whether the credential is revoked or suspended. */
  readonly credentialStatus?: CredentialStatus;
  /** Where a newer copy of the credential can be fetched. */
  readonly refreshService?: RefreshService;
  /** The terms of use that apply to the credential. */
  readonly termsOfUse?: readonly TermsOfUse[];
  /** Evidence that supports the claims. */
  readonly evidence?: readonly Evidence[];
}

/** Identify the type and location of a data schema. */
export interface CredentialSchema {
  /** The value MUST be a URI identifying the schema file. */
  readonly id: string;
  /** The value MUST identify the type of data schema validation. */
  readonly type: string;
}

/**
 * The information in CredentialStatus is used to discover information about the current status of a verifiable
 * credential, such as whether it is suspended or revoked.
 */
export interface CredentialStatus {
  /** The value MUST be the URL of the issuer's credential status method. */
  readonly id?: string;
  /** The name of the credential status method. */
  readonly type: string;
}

/** Claims about the credential subject. */
export interface CredentialSubject {
  /** The identity of the credential subject. */
  readonly id?: string;
}

/** A JSON-LD Linked Data proof. */
export interface Proof {
  /** Signature suite used to produce proof. */
  readonly type: string;
  /** Date the proof was created. */
  readonly created?: string;
  /** The suite used to create the proof. */
  readonly cryptosuite?: string;
  /** A value chosen by the verifier to mitigate authentication proof replay attacks. */
  readonly challenge?: string;
  /** The domain of the proof to restrict its use to a particular target. */
  readonly domain?: string;
  /** A value chosen by the creator of proof to randomize proof values for privacy purposes. */
  readonly nonce?: string;
  /** The purpose of the proof to be used with `verificationMethod`. */
  readonly proofPurpose?: string;
  /** Value of the proof. */
  readonly proofValue?: string;
  /** The URL of the public key that can verify the signature. */
  readonly verificationMethod?: string;
}

/** The information in RefreshService is used to refresh the verifiable credential. */
export interface RefreshService {
  /** The value MUST be the URL of the issuer's refresh service. */
  readonly id: string;
  /** The name of the refresh service method. */
  readonly type: string;
}

/**
 * Terms of use can be utilized by an issuer or a holder to communicate the terms under which a verifiable credential
 * or verifiable presentation was issued
 */
export interface TermsOfUse {
  /** The value MUST be a URI identifying the term of use. */
  readonly id?: string;
  /** The value MUST identify the type of the terms of use. */
  readonly type: string;
}

/** An issuer: the profile, or the URI of one (OB B.1.20). */
export type ProfileRef = Profile | string;
