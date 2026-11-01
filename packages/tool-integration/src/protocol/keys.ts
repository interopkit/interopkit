import { isRecord } from "@interopkit/core/checks";

/** The smallest RSA modulus in bits that a key for RS256 may have (RFC 7518 section 3.3). */
export const MIN_RSA_MODULUS_BITS = 2048;

/**
 * Returns whether a value is a key for RS256 of at least 2,048 bits that is usable for the given purpose: `sign` for a private
 * key, `verify` for a public key.
 */
export function isRsaKey(key: unknown, usage: "sign" | "verify"): boolean {
  if (!isRecord(key)) return false;
  const { algorithm, usages } = key;
  return (
    isRecord(algorithm) &&
    algorithm.name === "RSASSA-PKCS1-v1_5" &&
    typeof algorithm.modulusLength === "number" &&
    algorithm.modulusLength >= MIN_RSA_MODULUS_BITS &&
    isRecord(algorithm.hash) &&
    algorithm.hash.name === "SHA-256" &&
    Array.isArray(usages) &&
    usages.includes(usage)
  );
}
