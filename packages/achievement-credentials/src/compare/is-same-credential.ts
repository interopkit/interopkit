import type { CredentialV1p1, IssuableCredential } from "../model/index.js";
import { comparableOf, isSame } from "./comparable.js";

/**
 * Tells whether two credentials are the same credential (OB 10): they have the same `id` and the same issuer, compared after
 * the percent-encoded characters are unescaped and the white space around them is trimmed.
 *
 * @remarks
 * A credential with no `id` is the same as none. The comparison does not look at `validFrom`: `selectNewerCredential` tells which of
 * two equal credentials is the more recent.
 *
 * @param a - A credential.
 * @param b - Another credential.
 * @returns Whether they are equal.
 * @throws `DataError` when a credential is not an object with an `issuer` that is an address or a profile with an `id`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#credential-equality-and-comparison-algorithm | Open Badges 3.0, 10}
 */
export function isSameCredential(
  a: IssuableCredential | CredentialV1p1,
  b: IssuableCredential | CredentialV1p1,
): boolean {
  const first = comparableOf(a, "The first credential");
  const second = comparableOf(b, "The second credential");
  return isSame(first, second);
}
