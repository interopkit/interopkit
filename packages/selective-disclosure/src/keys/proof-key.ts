import { p256 } from "@noble/curves/nist.js";
import { encodeMultikey } from "./multikey.js";

/**
 * The bytes of random seed that a P-256 key is made from: the 48 bytes of FIPS 186-5 appendix A.2.2, 16 more than the order
 * of the curve holds, so that reducing the seed to a scalar leaves no bias.
 */
const SEED_BYTES = 48;

/** The key pair that belongs to one proof: it signs the statements a holder can hide, and nothing else. */
export interface ProofKey {
  /** The private key: 32 bytes. */
  readonly secretKey: Uint8Array;
  /** The public key in multikey form, which the proof carries. */
  readonly publicKey: Uint8Array;
}

/** Makes the key pair that belongs to a private key. */
export function proofKeyOf(secretKey: Uint8Array): ProofKey {
  return { secretKey, publicKey: encodeMultikey(p256.getPublicKey(secretKey, true)) };
}

/** Makes a new key pair from `crypto.getRandomValues`. */
export function createProofKey(): ProofKey {
  const seed = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
  return proofKeyOf(p256.utils.randomSecretKey(seed));
}
