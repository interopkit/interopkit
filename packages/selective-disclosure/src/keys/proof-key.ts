import { p256 } from "@noble/curves/nist.js";
import { ECDSA_P256, ES256 } from "./algorithm.js";
import { encodeMultikey } from "./multikey.js";

const encoder = new TextEncoder();

/** The key pair that belongs to one proof: it signs the statements a holder can hide, and nothing else. */
export interface ProofKey {
  /** The public key in multikey form, which the proof carries. */
  readonly publicKey: Uint8Array;
  /**
   * Signs the UTF-8 bytes of a statement with ES256: ECDSA over P-256 and SHA-256, as the 64 bytes of R and S.
   *
   * @param statement - One canonical N-Quad.
   */
  sign(statement: string): Promise<Uint8Array>;
}

/**
 * Makes a new key pair with Web Crypto.
 *
 * @remarks
 * The private key cannot be exported, so it leaves Web Crypto never and lives only as long as the proof that it signs for.
 * Web Crypto draws it and the nonce of each signature from the random source of the platform, as it does for the issuer's own
 * key, whose signature over the public key of the proof binds the statements.
 */
export async function createProofKey(): Promise<ProofKey> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(ECDSA_P256, false, ["sign"]);
  // Web Crypto exports a raw public key as an uncompressed point; the multikey form holds the compressed one.
  const point = p256.Point.fromBytes(new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)));
  return {
    publicKey: encodeMultikey(point.toBytes(true)),
    sign: async (statement) => new Uint8Array(await crypto.subtle.sign(ES256, privateKey, encoder.encode(statement))),
  };
}
