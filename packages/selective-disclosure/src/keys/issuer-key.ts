import { DataError } from "@interopkit/core";
import { ECDSA_P256, ES256 } from "./algorithm.js";

/**
 * Imports the key of the issuer's verification method, which can only verify.
 *
 * @param jwk - The public key as a JWK.
 * @returns The key, or `undefined` when it is not a public key of the curve P-256.
 * @throws `DataError` when the JWK holds a private key (`d`), which a verifier never has a use for.
 */
export async function importIssuerKey(jwk: JsonWebKey): Promise<CryptoKey | undefined> {
  if (jwk.d !== undefined) {
    throw new DataError("The option publicKeyJwk holds a private key (d): give the public key.");
  }
  const { kty, crv, x, y } = jwk;
  if (kty !== "EC" || crv !== ECDSA_P256.namedCurve) return undefined;
  try {
    // Only the members of the key: key_ops, alg or use in the JWK would have to agree with a verification.
    return await crypto.subtle.importKey("jwk", { kty, crv, x, y }, ECDSA_P256, false, ["verify"]);
  } catch {
    // A point that is not on the curve, or a coordinate that is not base64url, is a key that verifies nothing.
    return undefined;
  }
}

/** Tells whether the issuer's key made the signature over the data. */
export function verifyBaseSignature(key: CryptoKey, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
  // Copies: Web Crypto takes bytes over an ArrayBuffer, and these may lie over another kind of buffer.
  return crypto.subtle.verify(ES256, key, new Uint8Array(signature), new Uint8Array(data));
}
