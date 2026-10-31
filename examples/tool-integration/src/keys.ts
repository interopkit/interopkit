/** An RSA key pair for RS256 and an HMAC key for hints: what the platform and the tool each generate for themselves. */
export function generateSigningKeys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
}

/** The HMAC key with which a platform signs its hints, line item identifiers and access tokens. */
export function generateHintKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
