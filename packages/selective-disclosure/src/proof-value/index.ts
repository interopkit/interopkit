/**
 * The CBOR values of the proofs of the suite: the base proof value that the issuer's key signs around and the derived proof
 * value that a holder gives a verifier.
 *
 * @module
 */
export { type BaseProofValue, parseBaseProofValue, serializeBaseProofValue } from "./base.js";
export { type DerivedProofValue, parseDerivedProofValue, serializeDerivedProofValue } from "./derived.js";
export { isBaseProof } from "./is-base-proof.js";
export { signData } from "./sign-data.js";
