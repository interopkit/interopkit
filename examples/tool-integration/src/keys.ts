import { createCryptoKeySigner } from "@interopkit/core";
import type { KeySet } from "@interopkit/tool-integration";

/** An elliptic curve key pair on P-256 for ES256: what a tool generates for itself. */
export function generateSigningKeys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]) as Promise<CryptoKeyPair>;
}

/** The key set of a tool for ES256, as `serveToolJwks` publishes it: a signer and its public key under the same `kid`. */
export async function toolKeySet(pair: CryptoKeyPair, keyId: string): Promise<KeySet> {
  const publicKey = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: keyId, alg: "ES256", use: "sig" };
  return { signer: createCryptoKeySigner(pair.privateKey, { algorithm: "ES256", keyId }), publicKeys: [publicKey] };
}

/**
 * The key set of the platform: an RSA key pair for RS256, which Dynamic Registration requires among the algorithms of an
 * `id_token`, and whose signer could as well call a KMS that holds the private key.
 */
export async function generatePlatformKeys(keyId: string): Promise<KeySet> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicKey = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: keyId, alg: "RS256", use: "sig" };
  return { signer: createCryptoKeySigner(pair.privateKey, { algorithm: "RS256", keyId }), publicKeys: [publicKey] };
}

/** The HMAC key with which a platform seals its hints and access tokens. */
export function generateHintKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
