import { type Claims, type JwksCache, required, STRING, verifyJwt } from "../protocol/internal.js";
import type { PlatformRegistration } from "./registration.js";

/**
 * Verifies an `id_token` as the platform issued it: an algorithm of the registration, the signature against the platform's
 * key set, then the issuer, the audiences that the registration trusts, the authorized party and the times (Security
 * Framework section 5.1.3). The `nonce` and the LTI claims are the caller's to check.
 *
 * @param nowMs - The time in milliseconds since 1970-01-01T00:00:00Z.
 * @param signal - Ends the wait for the key set.
 * @returns The claims, with a `nonce`.
 * @throws `LtiError` with the reason of the failed check.
 */
export async function verifyIdToken(
  token: string,
  registration: PlatformRegistration,
  jwks: JwksCache,
  nowMs: number,
  signal?: AbortSignal,
): Promise<Claims> {
  const { issuer, clientId, algorithms, trustedAudiences } = registration;
  const claims = await verifyJwt(
    token,
    jwks.keySet(registration.jwksUrl, { signal }),
    {
      issuer,
      audience: clientId,
      authorizedParty: clientId,
      requiredClaims: ["exp", "iat"],
      ...(algorithms === undefined ? {} : { algorithms }),
      ...(trustedAudiences === undefined ? {} : { trustedAudiences }),
    },
    nowMs,
  );
  required(claims, "nonce", "The id_token", STRING);
  return claims;
}
