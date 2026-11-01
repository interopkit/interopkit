/**
 * The classes of CLR 2.0 (CLR B.1 to B.3), and the form of a ClrCredential in a JWT.
 *
 * @module
 */

import type { ContextEntry } from "./context.js";
import type {
  Achievement,
  CredentialSchema,
  CredentialStatus,
  EndorsementCredential,
  Evidence,
  IdentityObject,
  Image,
  ProfileRef,
  Proof,
  RefreshService,
  TermsOfUse,
  VerifiableCredential,
} from "./credentials.js";
import type {
  AchievementV1p1,
  EndorsementCredentialV1p1,
  ProfileV1p1,
  VerifiableCredentialV1p1,
} from "./credentials-v1p1.js";
import type { AssociationType } from "./vocabularies.js";

/**
 * A Comprehensive Learner Record: the achievement credentials of a learner, as a verifiable credential (CLR B.1.1).
 */
export interface ClrCredential {
  /**
   * The JSON-LD contexts, in order: the Verifiable Credentials context, the CLR context, then the Open Badges
   * context.
   */
  readonly "@context": readonly ContextEntry[];
  /** The types, which include `VerifiableCredential` and `ClrCredential`. */
  readonly type: readonly string[];
  /** Unambiguous reference to the credential. */
  readonly id: string;
  /** The name of the CLR. */
  readonly name: string;
  /** Optional description of the CLR. */
  readonly description?: string;
  /** Endorsements, as embedded credentials. */
  readonly endorsement?: readonly EndorsementCredential[];
  /**
   * Allows endorsers to make specific claims about the ClrCredential, or any AssertionCredential, Achievement, or
   * Profile referenced in the ClrCredential.
   */
  readonly endorsementJwt?: readonly string[];
  /** An image that represents it. */
  readonly image?: Image;
  /**
   * True if CLR does not contain all the assertions known by the publisher for the learner at the time the CLR is
   * issued.
   */
  readonly partial?: boolean;
  /** The subject, and what the credential asserts about it. */
  readonly credentialSubject: ClrSubject;
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

/** A collection of information about the learner that is the subject of this CLR credential. */
export interface ClrSubject {
  /** An identifier for the recipient of the CLR credential. */
  readonly id?: string;
  /** The types, which include `ClrSubject`. */
  readonly type: readonly string[];
  /** Identifiers of the recipient. */
  readonly identifier?: readonly IdentityObject[];
  /** The achievement that was earned. */
  readonly achievement?: readonly Achievement[];
  /** The credentials of the subject. */
  readonly verifiableCredential: readonly VerifiableCredential[];
  /** The associations between achievements. */
  readonly association?: readonly Association[];
}

/**
 * An Association describes the semantic relationship between two achievements and the credentials that assert those
 * achievements.
 */
export interface Association {
  /** The value of the type property MUST be 'Association'. */
  readonly type: "Association";
  /** The type of relationship between a source achievement and a target achievement. */
  readonly associationType: AssociationType;
  /** The `id` of the source achievement. */
  readonly sourceId: string;
  /** The `id` of the target achievement. */
  readonly targetId: string;
}

/** A ClrCredential under the Verifiable Credentials Data Model 1.1 (CLR B.1.1). */
export interface ClrCredentialV1p1 {
  /**
   * The JSON-LD contexts, in order: the Verifiable Credentials context, the CLR context, then the Open Badges
   * context.
   */
  readonly "@context": readonly ContextEntry[];
  /** The types, which include `VerifiableCredential` and `ClrCredential`. */
  readonly type: readonly string[];
  /** Unambiguous reference to the credential. */
  readonly id: string;
  /** The name of the CLR. */
  readonly name: string;
  /** Optional description of the CLR. */
  readonly description?: string;
  /** Endorsements, as embedded credentials. */
  readonly endorsement?: readonly EndorsementCredentialV1p1[];
  /**
   * Allows endorsers to make specific claims about the ClrCredential, or any AssertionCredential, Achievement, or
   * Profile referenced in the ClrCredential.
   */
  readonly endorsementJwt?: readonly string[];
  /** An image that represents it. */
  readonly image?: Image;
  /**
   * True if CLR does not contain all the assertions known by the publisher for the learner at the time the CLR is
   * issued.
   */
  readonly partial?: boolean;
  /** The subject, and what the credential asserts about it. */
  readonly credentialSubject: ClrSubjectV1p1;
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

/** A collection of information about the learner that is the subject of this CLR credential. */
export interface ClrSubjectV1p1 {
  /** An identifier for the recipient of the CLR credential. */
  readonly id?: string;
  /** The types, which include `ClrSubject`. */
  readonly type: readonly string[];
  /** Identifiers of the recipient. */
  readonly identifier?: readonly IdentityObject[];
  /** The achievement that was earned. */
  readonly achievement?: readonly AchievementV1p1[];
  /** The credentials of the subject. */
  readonly verifiableCredential: readonly VerifiableCredentialV1p1[];
  /** The associations between achievements. */
  readonly association?: readonly Association[];
}

/**
 * Represents a Comprehensive Learner Record (CLR) expressed to conform with the JSON Web Token Proof Format
 * Securing Verifiable Credentials using JOSE and COSE.
 */
export interface ClrCredentialJwtPayload {
  /** The subject, and what the credential asserts about it. */
  readonly credentialSubject: ClrSubjectJwtPayload;
  /** The JSON-LD contexts. */
  readonly "@context": readonly ContextEntry[];
  /** Unambiguous reference to the credential. */
  readonly id: string;
  /** The types, which include `VerifiableCredential` and `ClrCredential`. */
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
  /** The name of the CLR. */
  readonly name: string;
  /** Optional description of the CLR. */
  readonly description?: string;
  /** Endorsements, as embedded credentials. */
  readonly endorsement?: readonly EndorsementCredential[];
  /**
   * Allows endorsers to make specific claims about the ClrCredential, or any AssertionCredential, Achievement, or
   * Profile referenced in the ClrCredential.
   */
  readonly endorsementJwt?: readonly string[];
  /** An image that represents it. */
  readonly image?: Image;
  /**
   * True if CLR does not contain all the assertions known by the publisher for the learner at the time the CLR is
   * issued.
   */
  readonly partial?: boolean;
  /** Timestamp of when the credential was awarded. */
  readonly awardedDate?: string;
}

/** Claims about the subject learner. */
export interface ClrSubjectJwtPayload {
  /** The set of achievements the publisher claims have been awarded to the learner in Compact JWS format. */
  readonly verifiableCredential: readonly string[];
  /** An identifier for the recipient of the CLR credential. */
  readonly id?: string;
  /** The types, which include `ClrSubject`. */
  readonly type: readonly string[];
  /** Identifiers of the recipient. */
  readonly identifier?: readonly IdentityObject[];
  /** The achievement that was earned. */
  readonly achievement?: readonly Achievement[];
  /** The associations between achievements. */
  readonly association?: readonly Association[];
}

/** The answer to getCredentials of the CLR API (CLR B.3.1). */
export interface GetClrCredentialsResponse {
  /** The credentials of the page. */
  readonly credential?: readonly ClrCredential[];
  /** ClrCredentials that have been signed with the VC-JWT Proof Format MUST be in the `compactJwsString` array. */
  readonly compactJwsString?: readonly string[];
}
