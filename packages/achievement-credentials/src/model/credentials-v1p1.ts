/**
 * The classes of Open Badges 3.0 under the Verifiable Credentials Data Model 1.1 (OB B.9): a credential with `issuanceDate` and `expirationDate`.
 *
 * @module
 */

import type { ContextEntry } from "./context.js";
import type {
  Address,
  Alignment,
  CredentialSchema,
  CredentialStatus,
  CredentialSubject,
  Criteria,
  EndorsementSubject,
  Evidence,
  IdentifierEntry,
  IdentityObject,
  Image,
  Profile,
  Proof,
  RefreshService,
  Related,
  Result,
  ResultDescription,
  TermsOfUse,
} from "./credentials.js";
import type { AchievementType, ExtensionTerm } from "./vocabularies.js";

/** An achievement credential under the Verifiable Credentials Data Model 1.1 (OB B.9.2). */
export interface AchievementCredentialV1p1 {
  /** The JSON-LD contexts, in order: the Verifiable Credentials context, then the Open Badges context. */
  readonly "@context": readonly ContextEntry[];
  /** Unambiguous reference to the credential. */
  readonly id: string;
  /** The types, which include `VerifiableCredential` and `AchievementCredential` or `OpenBadgeCredential`. */
  readonly type: readonly string[];
  /** The name of the credential for display purposes in wallets. */
  readonly name: string;
  /** The short description of the credential for display purposes in wallets. */
  readonly description?: string;
  /** An image that represents it. */
  readonly image?: Image;
  /** Timestamp of when the credential was awarded. */
  readonly awardedDate?: string;
  /** The subject, and what the credential asserts about it. */
  readonly credentialSubject: AchievementSubjectV1p1;
  /** Endorsements, as embedded credentials. */
  readonly endorsement?: readonly EndorsementCredentialV1p1[];
  /**
   * Allows endorsers to make specific claims about the credential, and the achievement and profiles in the
   * credential.
   */
  readonly endorsementJwt?: readonly string[];
  /** The issuer: its profile. */
  readonly issuer: ProfileV1p1;
  /** Timestamp of when the credential was issued. */
  readonly issuanceDate: string;
  /**
   * If the credential has some notion of expiry, this indicates a timestamp when a credential should no longer be
   * considered valid.
   */
  readonly expirationDate?: string;
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

/** A verifiable credential that asserts a claim about an entity. */
export interface EndorsementCredentialV1p1 {
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
  readonly issuer: ProfileV1p1;
  /** Timestamp of when the credential was issued. */
  readonly issuanceDate: string;
  /**
   * If the credential has some notion of expiry, this indicates a timestamp when a credential should no longer be
   * considered valid.
   */
  readonly expirationDate?: string;
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

/** A Verifiable Credential as defined in the Verifiable Credentials Data Model 1.1. */
export interface VerifiableCredentialV1p1 {
  /** The JSON-LD contexts, in order. */
  readonly "@context": readonly ContextEntry[];
  /** Unambiguous reference to the credential. */
  readonly id?: string;
  /** The types, which include `VerifiableCredential`. */
  readonly type: readonly string[];
  /** The issuer: its profile. */
  readonly issuer: ProfileV1p1;
  /** Timestamp of when the credential was issued. */
  readonly issuanceDate: string;
  /**
   * If the credential has some notion of expiry, this indicates a timestamp when a credential should no longer be
   * considered valid.
   */
  readonly expirationDate?: string;
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

/** The recipient of an achievement and the achievement that they earned, under the Verifiable Credentials Data Model 1.1 (OB B.9.6). */
export interface AchievementSubjectV1p1 {
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
  readonly achievement: AchievementV1p1;
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
  readonly source?: ProfileV1p1;
  /** The academic term in which this assertion was achieved. */
  readonly term?: string;
}

/** A collection of information about the accomplishment recognized by the Assertion. */
export interface AchievementV1p1 {
  /** Unique URI for the Achievement. */
  readonly id: string;
  /** The types, which include `Achievement`. */
  readonly type: readonly string[];
  /** The nodes of educational frameworks that it aligns to. */
  readonly alignment?: readonly Alignment[];
  /** The type of achievement. */
  readonly achievementType?: AchievementType | ExtensionTerm;
  /** The person or organization that created it. */
  readonly creator?: ProfileV1p1;
  /** Credit hours associated with this entity, or credit hours possible. */
  readonly creditsAvailable?: number;
  /** The criteria to earn it. */
  readonly criteria: Criteria;
  /** A short description of the achievement. */
  readonly description: string;
  /** Endorsements, as embedded credentials. */
  readonly endorsement?: readonly EndorsementCredentialV1p1[];
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

/** A Profile is a collection of information that describes the entity or organization using Open Badges. */
export interface ProfileV1p1 {
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
  readonly endorsement?: readonly EndorsementCredentialV1p1[];
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
