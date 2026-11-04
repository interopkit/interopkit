/**
 * Data Integrity proofs of credentials: signing with `eddsa-rdfc-2022` and `ecdsa-sd-2023`, deriving a disclosure, verifying
 * a proof against the key of the issuer, JSON-LD safe mode, and the loader that serves contexts only at their pins.
 *
 * @module @interopkit/achievement-credentials/data-integrity
 */
export { addProof } from "./add-proof.js";
export { type ContextLoaderOptions, createContextLoader, KNOWN_CONTEXTS } from "./contexts.js";
export { deriveDisclosure } from "./derive-disclosure.js";
export type { DataIntegrityVerifyOptions, DisclosureOptions, ProofOptions, SigningCryptosuite } from "./options.js";
export { validateJsonLd } from "./validate-json-ld.js";
export { verifyProof } from "./verify-proof.js";
