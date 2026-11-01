import { from as ecdsaFrom, toJwk as ecdsaToJwk } from "@interop/ecdsa-multikey";
import { Ed25519VerificationKey } from "@interop/ed25519-verification-key";
import { publicJwk } from "./jwk.js";

/** The multibase prefix of a base58btc Multikey with the multicodec of an Ed25519 public key (`z6Mk`). */
const ED25519_HEADER = "z6Mk";

/** The multibase prefixes of a Multikey of a P-256 public key (`zDna`) and of a P-384 public key (`z82L`), compressed. */
export const ECDSA_HEADERS = ["zDna", "z82L"] as const;

/**
 * The most characters of a `publicKeyMultibase`: an Ed25519 key has 48 and a compressed P-384 key has 69, so a longer value is
 * no key of these types and is never decoded.
 */
const MAX_MULTIBASE_CHARS = 128;

/**
 * Converts a `publicKeyMultibase` of a Multikey into a public JWK.
 *
 * @returns The key, or `undefined` when the value is not an Ed25519, P-256 or P-384 Multikey.
 */
export async function jwkOfMultibase(publicKeyMultibase: unknown): Promise<JsonWebKey | undefined> {
  if (typeof publicKeyMultibase !== "string" || publicKeyMultibase.length > MAX_MULTIBASE_CHARS) return undefined;
  const description = { type: "Multikey", id: "urn:key", controller: "urn:key", publicKeyMultibase };
  try {
    if (publicKeyMultibase.startsWith(ED25519_HEADER)) {
      const key = await Ed25519VerificationKey.from(description);
      return publicJwk(key.toJwk());
    }
    if ((ECDSA_HEADERS as readonly string[]).includes(publicKeyMultibase.slice(0, 4))) {
      return publicJwk(await ecdsaToJwk({ keyPair: await ecdsaFrom(description) }));
    }
  } catch {
    // The libraries throw on a value that has the header and no point on the curve.
    return undefined;
  }
  return undefined;
}
