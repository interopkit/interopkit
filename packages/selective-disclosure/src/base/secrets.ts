import { createProofKey, type ProofKey } from "../keys/index.js";
import { HMAC_KEY_BYTES } from "../suite.js";

/**
 * What a base proof keeps secret from everyone but the holder, and what must be unpredictable: whoever knows either can
 * replace the statements that a holder may hide.
 */
export interface Secrets {
  /** The key of the HMAC that gives blank nodes their labels: 32 bytes. */
  readonly hmacKey: Uint8Array;
  /** The key pair that signs the statements a holder may hide. */
  readonly proofKey: ProofKey;
}

/** Makes new secrets from `crypto.getRandomValues`. */
export function createSecrets(): Secrets {
  return { hmacKey: crypto.getRandomValues(new Uint8Array(HMAC_KEY_BYTES)), proofKey: createProofKey() };
}
