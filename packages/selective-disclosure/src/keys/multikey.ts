import { DataError } from "@interopkit/core";
import { p256 } from "@noble/curves/nist.js";
import { MULTIKEY_P256_HEADER, PUBLIC_KEY_BYTES } from "../suite.js";
import { ECDSA_P256 } from "./algorithm.js";

/** Writes a compressed P-256 point as a multikey: the header of `p256-pub` and the 33 bytes of the point. */
export function encodeMultikey(compressedPoint: Uint8Array): Uint8Array {
  const multikey = new Uint8Array(PUBLIC_KEY_BYTES);
  multikey.set(MULTIKEY_P256_HEADER);
  multikey.set(compressedPoint, MULTIKEY_P256_HEADER.length);
  return multikey;
}

/**
 * Imports the public key of a proof, which can only verify.
 *
 * @param multikey - The key as `parseBaseProofValue` and `parseDerivedProofValue` return it: the header and a compressed point.
 * @throws `DataError` when the bytes are not a point of the curve P-256.
 */
export async function importMultikey(multikey: Uint8Array): Promise<CryptoKey> {
  let uncompressed: Uint8Array;
  try {
    uncompressed = p256.Point.fromBytes(multikey.subarray(MULTIKEY_P256_HEADER.length)).toBytes(false);
  } catch (cause) {
    throw new DataError("The publicKey of the proof is not a point of the curve P-256.", { cause });
  }
  // Web Crypto reads a raw key as an uncompressed point only, over an ArrayBuffer.
  return crypto.subtle.importKey("raw", new Uint8Array(uncompressed), ECDSA_P256, false, ["verify"]);
}
