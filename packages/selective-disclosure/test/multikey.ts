import type { Signer } from "@interopkit/core";
import { p256 } from "@noble/curves/nist.js";
import { base58, base64urlnopad, hex } from "@scure/base";

/** The bytes of the header of a multikey key of P-256: `p256-priv` (0x1306) and `p256-pub` (0x1200) as varints. */
const HEADER_BYTES = 2;

/** The 32 bytes of a private key from its multibase form. */
export function secretKeyOf(multibase: string): Uint8Array {
  return base58.decode(multibase.slice(1)).subarray(HEADER_BYTES);
}

/** The public key of a verification method from its multibase form, as the JWK that a verifier resolves. */
export function jwkOf(multibase: string): JsonWebKey {
  const point = p256.Point.fromBytes(base58.decode(multibase.slice(1)).subarray(HEADER_BYTES)).toAffine();
  const coordinate = (value: bigint) => base64urlnopad.encode(hex.decode(value.toString(16).padStart(64, "0")));
  return { kty: "EC", crv: "P-256", x: coordinate(point.x), y: coordinate(point.y) };
}

/** A signer with a fixed key and a deterministic signature (RFC 6979), which the vectors of the Recommendation use. */
export function deterministicSigner(secretKey: Uint8Array, keyId: string): Signer {
  return {
    algorithm: "ES256",
    keyId,
    sign: async (data) => p256.sign(data, secretKey, { lowS: false }),
  };
}
