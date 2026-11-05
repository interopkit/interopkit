/**
 * The `ecdsa-sd-2023` Data Integrity cryptosuite, which lets a holder reveal part of a verifiable credential: the issuer's
 * base proof, the holder's derived proof and the verifier's check. It does not implement SD-JWT or BBS.
 *
 * It also exports the types of `@interopkit/core` that its declarations name, which a program that installs this
 * package imports from here.
 *
 * @module @interopkit/selective-disclosure
 */

export type { CallOptions, Signer } from "@interopkit/core";
export { addBaseProof, type BaseProofOptions } from "./base/index.js";
export { type DeriveProofOptions, deriveProof } from "./derive/index.js";
export type { JsonDocument } from "./document/index.js";
export { isBaseProof } from "./proof-value/index.js";
export { selectiveDisclosureSuite, type VerifyProofOptions } from "./verify/index.js";
