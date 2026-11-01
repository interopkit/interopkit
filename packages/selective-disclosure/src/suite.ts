/** The `cryptosuite` of the proofs, which the W3C Recommendation Data Integrity ECDSA Cryptosuites v1.0 names. */
export const CRYPTOSUITE = "ecdsa-sd-2023";

/** The `type` of every Data Integrity proof. */
export const PROOF_TYPE = "DataIntegrityProof";

/** The `proofPurpose` of a base proof: a credential is an assertion by its issuer. */
export const PROOF_PURPOSE = "assertionMethod";

/** The bytes of an ECDSA P-256 signature as JOSE and Web Crypto write it: R and S, 32 bytes each. */
export const SIGNATURE_BYTES = 64;

/** The bytes of the multikey form of a P-256 public key: the 2 bytes of the `p256-pub` header and a 33-byte compressed point. */
export const PUBLIC_KEY_BYTES = 35;

/** The `p256-pub` multicodec code, 0x1200, as a varint (Data Integrity ECDSA Cryptosuites, section 2.1.1). */
export const MULTIKEY_P256_HEADER: Uint8Array = Uint8Array.of(0x80, 0x24);

/** The bytes of the key of the HMAC that relabels blank nodes: as long as the SHA-256 digest (RFC 2104 section 3). */
export const HMAC_KEY_BYTES = 32;

/** The bytes of the HMAC digest that stands for one blank node in the label map of a derived proof. */
export const LABEL_BYTES = 32;
