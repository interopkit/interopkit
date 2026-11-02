import { isRecord } from "@interopkit/core/checks";

/** The smallest RSA modulus in bits that a key for RS256, RS384 or RS512 may have (RFC 7518 section 3.3). */
export const MIN_RSA_MODULUS_BITS = 2048;

/** The hashes of RS256, RS384 and RS512 (RFC 7518 section 3.3). */
const RSA_HASHES: readonly unknown[] = ["SHA-256", "SHA-384", "SHA-512"];
/** The curves of ES256, ES384 and ES512 (RFC 7518 section 3.4). */
const EC_CURVES: readonly unknown[] = ["P-256", "P-384", "P-521"];

/** Returns whether the algorithm of a `CryptoKey` is one that an approved algorithm of LTI uses (Security Framework section 7.2). */
function isApprovedKeyAlgorithm(algorithm: Readonly<Record<string, unknown>>): boolean {
  if (algorithm.name === "ECDSA") return EC_CURVES.includes(algorithm.namedCurve);
  return (
    algorithm.name === "RSASSA-PKCS1-v1_5" &&
    typeof algorithm.modulusLength === "number" &&
    algorithm.modulusLength >= MIN_RSA_MODULUS_BITS &&
    isRecord(algorithm.hash) &&
    RSA_HASHES.includes(algorithm.hash.name)
  );
}

/**
 * Returns whether a value is a public `CryptoKey` that verifies tokens with one of the approved algorithms: an RSA key of at
 * least 2,048 bits for RS256, RS384 or RS512, or an elliptic curve key on P-256, P-384 or P-521.
 */
export function isVerifyKey(key: unknown): boolean {
  if (!isRecord(key) || key.type !== "public") return false;
  const { algorithm, usages } = key;
  return isRecord(algorithm) && isApprovedKeyAlgorithm(algorithm) && Array.isArray(usages) && usages.includes("verify");
}
