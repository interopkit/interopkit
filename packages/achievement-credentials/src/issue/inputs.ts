import type {
  Achievement,
  AchievementCredential,
  Association,
  CredentialStatus,
  EndorsementCredential,
  Evidence,
  IdentityObject,
  Image,
  Profile,
  RefreshService,
  Result,
  TermsOfUse,
} from "../model/index.js";

/** What `buildAchievementCredential` needs to write an AchievementCredential. */
export interface AchievementCredentialInput {
  /** The address of the credential, an absolute URI. */
  readonly id: string;
  /** The issuer. */
  readonly issuer: Profile;
  /** When the credential becomes valid, as an RFC 3339 date and time with an offset. */
  readonly validFrom: string;
  /** When the credential stops being valid. */
  readonly validUntil?: string;
  /** The name of the credential for display in a wallet. */
  readonly name: string;
  /** A short description of the credential for display in a wallet. */
  readonly description?: string;
  /** An image that represents the credential. */
  readonly image?: Image;
  /** Who earned the achievement, and what the earner did. At least one of `id` and `identifier` (OB B.1.3). */
  readonly subject: {
    /** The identifier of the earner, such as a DID. */
    readonly id?: string;
    /** Other identifiers of the earner. */
    readonly identifier?: readonly IdentityObject[];
    /** The results that the earner achieved. */
    readonly result?: readonly Result[];
    /** When the earner began the activity. */
    readonly activityStartDate?: string;
    /** When the earner ended the activity. */
    readonly activityEndDate?: string;
    /** The credits that the earner earned. */
    readonly creditsEarned?: number;
    /** The role of the earner in the achievement. */
    readonly role?: string;
    /** The term of the activity. */
    readonly term?: string;
  };
  /** The achievement that was earned. */
  readonly achievement: Achievement;
  /** When the credential was awarded. */
  readonly awardedDate?: string;
  /** Evidence that supports the claims. */
  readonly evidence?: readonly Evidence[];
  /** Endorsements of the credential, as embedded credentials. */
  readonly endorsement?: readonly EndorsementCredential[];
  /** Endorsements of the credential, as compact JWS. */
  readonly endorsementJwt?: readonly string[];
  /** How a verifier learns whether the credential is revoked or suspended. */
  readonly credentialStatus?: CredentialStatus;
  /** Where a newer copy of the credential can be fetched. */
  readonly refreshService?: RefreshService;
  /** The terms of use that apply to the credential. */
  readonly termsOfUse?: readonly TermsOfUse[];
}

/** What `buildEndorsementCredential` needs to write an EndorsementCredential. */
export interface EndorsementCredentialInput {
  /** The address of the endorsement, an absolute URI. */
  readonly id: string;
  /** The endorser. */
  readonly issuer: Profile;
  /** When the endorsement becomes valid, as an RFC 3339 date and time with an offset. */
  readonly validFrom: string;
  /** The name of the endorsement. */
  readonly name: string;
  /** The identifier of the achievement, profile or credential that is endorsed. */
  readonly endorses: string;
  /** The comment of the endorser. */
  readonly comment?: string;
  /** When the endorsement stops being valid. */
  readonly validUntil?: string;
  /** How a verifier learns whether the endorsement is revoked or suspended. */
  readonly credentialStatus?: CredentialStatus;
}

/**
 * What `buildClrCredential` needs to write a ClrCredential.
 *
 * @typeParam TCredential - What the CLR holds: `AchievementCredential` objects for a ClrCredential, or compact JWS strings for
 * the payload of a CLR that is signed as a VC-JWT (CLR 7.2.4.1), whose credentials are signed first.
 */
export interface ClrCredentialInput<TCredential extends AchievementCredential | string = AchievementCredential> {
  /** The address of the CLR, an absolute URI. */
  readonly id: string;
  /** The issuer. */
  readonly issuer: Profile;
  /** When the CLR becomes valid, as an RFC 3339 date and time with an offset. */
  readonly validFrom: string;
  /** When the CLR stops being valid. */
  readonly validUntil?: string;
  /** The name of the CLR. */
  readonly name: string;
  /** The learner. At least one of `id` and `identifier` (CLR B.1.2). */
  readonly subject: {
    /** The identifier of the learner, such as a DID. */
    readonly id?: string;
    /** Other identifiers of the learner. */
    readonly identifier?: readonly IdentityObject[];
  };
  /** The credentials that the learner was awarded, at least one. */
  readonly credentials: readonly TCredential[];
  /** Achievements that the CLR holds on its own, without a credential for each. */
  readonly achievements?: readonly Achievement[];
  /** The associations between the achievements of the CLR. */
  readonly associations?: readonly Association[];
  /** Whether the CLR is a partial record of the learner. */
  readonly partial?: boolean;
  /** How a verifier learns whether the CLR is revoked or suspended. */
  readonly credentialStatus?: CredentialStatus;
  /** Where a newer copy of the CLR can be fetched. */
  readonly refreshService?: RefreshService;
}
