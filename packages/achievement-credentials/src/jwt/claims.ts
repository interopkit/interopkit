import { isRecord } from "@interopkit/core/checks";
import type { AnyVerifiableCredential } from "../model/index.js";

/** The claims of a JWT that carry a credential's `issuer`, `id`, start, end and subject (Open Badges 8.2.2, VC-JWT). */
const CREDENTIAL_CLAIMS = ["iss", "jti", "nbf", "exp", "sub"] as const;

/** The claims that a JWT adds to a credential and that the credential does not hold: they are removed before it is read. */
export const ADDED_CLAIMS: readonly string[] = [...CREDENTIAL_CLAIMS, "iat"];

const MILLISECONDS_PER_SECOND = 1000;

/** Converts a NumericDate (RFC 7519 section 2) to the `xsd:dateTime` of a credential, in UTC with whole seconds. */
export function dateTimeOf(seconds: number): string {
  return new Date(seconds * MILLISECONDS_PER_SECOND).toISOString().replace(".000Z", "Z");
}

/** Converts the `xsd:dateTime` of a credential to a NumericDate, in whole seconds, or `NaN` when it is no date. */
function secondsOf(dateTime: string): number {
  return Math.floor(Date.parse(dateTime) / MILLISECONDS_PER_SECOND);
}

/** The values of a credential that the claims of its JWT repeat. */
export interface CredentialValues {
  readonly issuer: string;
  readonly id: string | undefined;
  readonly start: string | undefined;
  readonly end: string | undefined;
  readonly subject: string | undefined;
}

/** Reads from a credential of either data model the values that the claims of its JWT repeat. */
export function valuesOf(credential: AnyVerifiableCredential): CredentialValues {
  const { issuer, id, credentialSubject } = credential;
  const subject: unknown = credentialSubject;
  return {
    issuer: typeof issuer === "string" ? issuer : issuer.id,
    id,
    start: "issuanceDate" in credential ? credential.issuanceDate : credential.validFrom,
    end: "issuanceDate" in credential ? credential.expirationDate : credential.validUntil,
    subject: isRecord(subject) && typeof subject.id === "string" ? subject.id : undefined,
  };
}

/** Builds the claims that Open Badges 8.2.2 asks a JWT to repeat from the credential it carries. */
export function claimsOf(credential: AnyVerifiableCredential): Readonly<Record<string, string | number>> {
  const { issuer, id, start, end, subject } = valuesOf(credential);
  return {
    iss: issuer,
    ...(id === undefined ? {} : { jti: id }),
    ...(start === undefined ? {} : { nbf: secondsOf(start) }),
    ...(subject === undefined ? {} : { sub: subject }),
    ...(end === undefined ? {} : { exp: secondsOf(end) }),
  };
}

/**
 * Finds the first claim of a JWT that says something other than the credential it carries.
 *
 * @returns A sentence that names the claim, or `undefined` when every claim that is present agrees.
 */
export function disagreement(
  payload: Readonly<Record<string, unknown>>,
  credential: AnyVerifiableCredential,
): string | undefined {
  const values = valuesOf(credential);
  const expected: Readonly<Record<string, string | number | undefined>> = {
    iss: values.issuer,
    jti: values.id,
    sub: values.subject,
    nbf: values.start === undefined ? undefined : secondsOf(values.start),
    exp: values.end === undefined ? undefined : secondsOf(values.end),
  };
  for (const claim of CREDENTIAL_CLAIMS) {
    const claimed = payload[claim];
    const wanted = expected[claim];
    if (claimed !== undefined && wanted !== undefined && claimed !== wanted) {
      return `The claim ${claim} is ${JSON.stringify(claimed)} and the credential says ${JSON.stringify(wanted)}.`;
    }
  }
  return undefined;
}
