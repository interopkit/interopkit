import { DataError } from "@interopkit/core";
import type { Achievement, AnyCredential, AnyVerifiableCredential, BadgeAssertionV2 } from "../model/index.js";
import { readCredential } from "../read/index.js";
import { verifiedKindOf } from "../read/internal.js";

/** What a summary takes from the achievement of a credential, in either data model. */
type Shown = Pick<Achievement, "name" | "description" | "image">;

/**
 * What a wallet shows of a credential (OB conformance 4): the same for an Open Badges credential, a CLR, an endorsement and an
 * Open Badges 2.0 assertion.
 */
export interface CredentialSummary {
  /**
   * What the credential is: an achievement (`badge`), a CLR (`clr`), an endorsement (`endorsement`) or an Open Badges 2.0
   * assertion (`badge-v2`).
   */
  readonly kind: "badge" | "clr" | "endorsement" | "badge-v2";
  /** The name of the credential, or for an achievement credential with none, the name of its achievement or BadgeClass. */
  readonly name: string;
  /** The description of the credential, or of its achievement or BadgeClass. */
  readonly description?: string;
  /** The address of the image of the credential, or of its achievement or BadgeClass. */
  readonly image?: string;
  /** The name of the issuer, when the credential holds the profile of the issuer. */
  readonly issuerName?: string;
  /** The address of the issuer. */
  readonly issuer: string;
  /**
   * When the credential became valid: `validFrom`, `issuanceDate` under the Verifiable Credentials Data Model 1.1, or the
   * `issuedOn` of a 2.0 assertion.
   */
  readonly validFrom: string;
  /**
   * When the achievement was awarded, which a displayer shows as the date of issue: the `awardedDate` of a credential that names
   * one, which stays when a reissue moves `validFrom` (OB B.1.2).
   *
   * @defaultValue none: show `validFrom`
   */
  readonly awardedDate?: string;
  /** When the credential stops being valid: `validUntil`, `expirationDate`, or the `expires` of a 2.0 assertion. */
  readonly validUntil?: string;
}

/** Summarizes an Open Badges 2.0 assertion: the image of the assertion, else that of its BadgeClass. */
function summaryV2({ assertion, badge, issuer }: BadgeAssertionV2): CredentialSummary {
  const image = assertion.image ?? badge.image;
  return {
    kind: "badge-v2",
    name: badge.name,
    description: badge.description,
    image: typeof image === "string" ? image : image.id,
    issuerName: issuer.name,
    issuer: issuer.id,
    validFrom: assertion.issuedOn,
    ...(assertion.expires === undefined ? {} : { validUntil: assertion.expires }),
  };
}

/** The achievement of an achievement credential, when the subject holds one. */
function achievementOf(credential: AnyVerifiableCredential): Shown | undefined {
  const subject = credential.credentialSubject;
  if (!("achievement" in subject)) return undefined;
  const { achievement } = subject;
  // A CLR holds a list of achievements, which no single credential shows.
  return achievement !== undefined && "name" in achievement ? achievement : undefined;
}

/**
 * Summarizes a credential for display: its name, description, image, issuer and dates, for an Open Badges credential, a CLR
 * or an endorsement under either Verifiable Credentials data model, or an Open Badges 2.0 assertion.
 *
 * @remarks
 * The credential is read as `readCredential` reads it, so a value that is not a credential is refused. An achievement
 * credential with no `name`, `description` or `image` of its own is shown by those of its achievement. A 2.0 assertion is
 * shown by its BadgeClass, with the image of the assertion when it has one, and its dates are `issuedOn` and `expires`.
 *
 * @param credential - The credential.
 * @returns The summary.
 * @throws `DataError` when the value is not a credential, or is a `VerifiableCredential` that is neither an achievement
 * credential, a CLR nor an endorsement, which the specifications give nothing to show for.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/cert/ | Open Badges 3.0 conformance, 4}
 */
export function credentialSummary(credential: AnyCredential): CredentialSummary {
  const read = readCredential(credential);
  // Every verifiable credential has a context, and a 2.0 badge has none.
  return "@context" in read ? summaryOf(read) : summaryV2(read);
}

/** Summarizes a verifiable credential of Open Badges 3.0 or CLR 2.0, under either data model. */
function summaryOf(read: AnyVerifiableCredential): CredentialSummary {
  const kind = verifiedKindOf(read.type);
  if (kind === undefined) {
    throw new DataError(
      "The credential is a VerifiableCredential of no class that Open Badges or CLR defines, so there is nothing to show.",
    );
  }
  const achievement = achievementOf(read);
  const issuer = read.issuer;
  const name = ("name" in read ? read.name : undefined) ?? achievement?.name;
  const description = ("description" in read ? read.description : undefined) ?? achievement?.description;
  const image = ("image" in read ? read.image : undefined) ?? achievement?.image;
  return {
    kind,
    // Every class that a kind names has a name, or a subject with an achievement that has one; the empty string is for the types.
    name: name ?? "",
    ...(description === undefined ? {} : { description }),
    ...(image === undefined ? {} : { image: image.id }),
    ...(typeof issuer === "string" || issuer.name === undefined ? {} : { issuerName: issuer.name }),
    issuer: typeof issuer === "string" ? issuer : issuer.id,
    ...datesOf(read),
  };
}

/** The dates of a credential that a displayer shows, under either data model. */
function datesOf(read: AnyVerifiableCredential): Pick<CredentialSummary, "validFrom" | "awardedDate" | "validUntil"> {
  const [validFrom, validUntil] =
    "issuanceDate" in read ? [read.issuanceDate, read.expirationDate] : [read.validFrom, read.validUntil];
  const awardedDate = "awardedDate" in read ? read.awardedDate : undefined;
  return {
    validFrom,
    ...(awardedDate === undefined ? {} : { awardedDate }),
    ...(validUntil === undefined ? {} : { validUntil }),
  };
}
