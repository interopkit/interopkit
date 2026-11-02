import { DataError } from "@interopkit/core";
import { checkRemoteUrl, describe } from "@interopkit/core/checks";
import { LtiError } from "../../errors.js";

/**
 * Refuses an address that a platform's document or answer gives, which the tool's server fetches or sends a token to, unless it
 * names a public host (`checkRemoteUrl`).
 *
 * @throws `LtiError` (`service-origin-refused`) when it does not.
 */
export function refuseAddress(url: string, label: string): void {
  try {
    checkRemoteUrl(url, label);
  } catch (error) {
    if (error instanceof DataError) throw new LtiError(error.message, "service-origin-refused");
    throw error;
  }
}

/**
 * Returns whether an address lies below an issuer, as Dynamic Registration 1.0 section 3.4 has the OpenID configuration: the same
 * origin, after parsing, a path equal to the issuer's or below it at a slash, and no fragment. Parsing makes `evil.io` of
 * `https://platform.example.com.evil.io` and of `https://platform.example.com@evil.io`, and resolves `..` before the comparison.
 */
export function isBelowIssuer(url: string, issuer: string): boolean {
  const address = new URL(url);
  const base = new URL(issuer);
  if (address.origin !== base.origin || address.hash !== "") return false;
  const prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return address.pathname === base.pathname || address.pathname.startsWith(prefix);
}

/**
 * Checks an address of registration, to which the registration token or an access token goes: on one of `origins`, which the host
 * trusts, or a public host on the origin of the issuer.
 *
 * @throws `LtiError` (`service-origin-refused`) for an address that names no public host, (`issuer-mismatch`) for one on another
 * origin.
 */
export function checkRegistrationAddress(url: string, issuer: string, origins: readonly string[], label: string): void {
  const { origin } = new URL(url);
  if (origins.includes(origin)) return;
  refuseAddress(url, label);
  if (origin !== new URL(issuer).origin) {
    throw new LtiError(
      `${label} must be on the origin of the issuer ${describe(issuer)} or on one of the registrationOrigins, found ${describe(url)}.`,
      "issuer-mismatch",
    );
  }
}
