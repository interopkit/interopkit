import { DataError } from "@interopkit/core";
import type { Achievement, AnyCredential } from "../model/index.js";

/** What a summary takes from the achievement of a credential, in either data model. */
type Shown = Pick<Achievement, "name" | "description" | "image">;

import { readCredential } from "../read/index.js";

/** What a wallet shows of a credential (OB conformance 4): the same for an Open Badges credential, a CLR and an endorsement. */
export interface CredentialSummary {
  /** What the credential is: an achievement (`badge`), a CLR (`clr`) or an endorsement (`endorsement`). */
  readonly kind: "badge" | "clr" | "endorsement";
  /** The name of the credential, or for an achievement credential with none, the name of its achievement. */
  readonly name: string;
  /** The description of the credential, or of its achievement. */
  readonly description?: string;
  /** The address of the image of the credential, or of its achievement. */
  readonly image?: string;
  /** The name of the issuer, when the credential holds the profile of the issuer. */
  readonly issuerName?: string;
  /** The address of the issuer. */
  readonly issuer: string;
  /** When the credential became valid: `validFrom`, or `issuanceDate` under the Verifiable Credentials Data Model 1.1. */
  readonly validFrom: string;
  /** When the credential stops being valid: `validUntil`, or `expirationDate`. */
  readonly validUntil?: string;
}

/** The achievement of an achievement credential, when the subject holds one. */
function achievementOf(credential: AnyCredential): Shown | undefined {
  const subject = credential.credentialSubject;
  if (!("achievement" in subject)) return undefined;
  const { achievement } = subject;
  // A CLR holds a list of achievements, which no single credential shows.
  return achievement !== undefined && "name" in achievement ? achievement : undefined;
}

/**
 * Summarizes a credential for display: its name, description, image, issuer and dates, for an Open Badges credential, a CLR
 * or an endorsement, under either Verifiable Credentials data model.
 *
 * @remarks
 * The credential is read as `readCredential` reads it, so a value that is not a credential is refused. An achievement
 * credential with no `name`, `description` or `image` of its own is shown by those of its achievement.
 *
 * @param credential - The credential.
 * @returns The summary.
 * @throws `DataError` when the value is not a credential, or is a `VerifiableCredential` that is neither an achievement
 * credential, a CLR nor an endorsement, which the specifications give nothing to show for.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/cert/ | Open Badges 3.0 conformance, 4}
 */
export function credentialSummary(credential: AnyCredential): CredentialSummary {
  const read = readCredential(credential);
  const kind = kindOf(read.type);
  if (kind === undefined) {
    throw new DataError(
      "The credential is a VerifiableCredential of no class that Open Badges or CLR defines, so there is nothing to show.",
    );
  }
  const achievement = achievementOf(read);
  const [validFrom, validUntil] =
    "issuanceDate" in read ? [read.issuanceDate, read.expirationDate] : [read.validFrom, read.validUntil];
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
    validFrom,
    ...(validUntil === undefined ? {} : { validUntil }),
  };
}

/** Tells what a credential is from its types. */
function kindOf(types: readonly string[]): CredentialSummary["kind"] | undefined {
  if (types.includes("ClrCredential")) return "clr";
  if (types.includes("EndorsementCredential")) return "endorsement";
  if (types.includes("AchievementCredential") || types.includes("OpenBadgeCredential")) return "badge";
  return undefined;
}
