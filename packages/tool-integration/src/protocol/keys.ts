import { isRecord } from "@interopkit/core/checks";

/** Returns whether a value is a key for RS256 that is usable for the given purpose: `sign` for a private key, `verify` for a public key. */
export function isRsaKey(key: unknown, usage: "sign" | "verify"): boolean {
  if (!isRecord(key)) return false;
  const { algorithm, usages } = key;
  return (
    isRecord(algorithm) &&
    algorithm.name === "RSASSA-PKCS1-v1_5" &&
    isRecord(algorithm.hash) &&
    algorithm.hash.name === "SHA-256" &&
    Array.isArray(usages) &&
    usages.includes(usage)
  );
}
