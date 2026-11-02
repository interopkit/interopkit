import { type Claims, type JwksCache, required, STRING, verifyJwt } from "../protocol/internal.js";
import type { PlatformRegistration } from "./registration.js";

/**
 * Verifies an `id_token` as the platform issued it: the signature against the platform's key set, then the issuer, the
 * audience, the authorized party and the times (Security Framework section 5.1.3). The `nonce` and the LTI claims are the
 * caller's to check.
 *
 * @param nowMilliseconds - The time in milliseconds since 1970-01-01T00:00:00Z.
 * @param signal - Ends the wait for the key set.
 * @returns The claims, with a `nonce`.
 * @throws `LtiError` with the reason of the failed check.
 */
export async function verifyIdToken(
  token: string,
  registration: PlatformRegistration,
  jwks: JwksCache,
  nowMilliseconds: number,
  signal?: AbortSignal,
): Promise<Claims> {
  const { issuer, clientId } = registration;
  const claims = await verifyJwt(
    token,
    jwks.keySet(registration.jwksUrl, { signal }),
    { issuer, audience: clientId, authorizedParty: clientId, requiredClaims: ["exp", "iat"] },
    nowMilliseconds,
  );
  required(claims, "nonce", "The id_token", STRING);
  return claims;
}
