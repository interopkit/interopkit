import { DataError } from "@interopkit/core";
import { isDateTime, parseDateTime } from "@interopkit/core/checks";
import type { CredentialV1p1, IssuableCredential } from "../model/index.js";
import { comparableOf, isSame } from "./comparable.js";

/** Reads the instant a credential became valid, or refuses it. */
function validFromOf(validFrom: string | undefined, label: string): number {
  if (validFrom === undefined || !isDateTime(validFrom)) {
    throw new DataError(
      `${label} has no validFrom that is a date and time of RFC 3339 with an offset, found ${JSON.stringify(validFrom)}.`,
    );
  }
  return parseDateTime(validFrom);
}

/**
 * Returns the more recent of two equal credentials (OB 10): the one with the newer `validFrom`, which a host may treat as the
 * replacement of the other.
 *
 * @remarks
 * Two credentials are equal when `isSameCredential` says so. The function returns one of its arguments, and the first when both
 * became valid at the same instant. `validFrom` is compared as an instant, so that offsets do not matter. A credential under
 * the Verifiable Credentials Data Model 1.1 became valid at its `issuanceDate`.
 *
 * @param a - A credential.
 * @param b - Another credential.
 * @returns `a` or `b`.
 * @throws `DataError` when a credential is not an object with an `issuer` and a `validFrom` or an `issuanceDate`, or when the two
 * are not the same credential.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#credential-equality-and-comparison-algorithm | Open Badges 3.0, 10}
 */
export function selectNewerCredential<TCredential extends IssuableCredential | CredentialV1p1>(
  a: TCredential,
  b: TCredential,
): TCredential {
  const first = comparableOf(a, "The first credential");
  const second = comparableOf(b, "The second credential");
  const [firstFrom, secondFrom] = [
    validFromOf(first.validFrom ?? first.issuanceDate, "The first credential"),
    validFromOf(second.validFrom ?? second.issuanceDate, "The second credential"),
  ];
  if (!isSame(first, second)) {
    throw new DataError("The credentials are not the same credential: they differ in id or in the id of the issuer.");
  }
  return secondFrom > firstFrom ? b : a;
}
