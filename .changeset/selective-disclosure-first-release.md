---
"@interopkit/selective-disclosure": major
---

The `ecdsa-sd-2023` cryptosuite in its three roles. `addBaseProof` gives an issuer's credential a base proof that signs every
statement a holder may hide; `deriveProof` gives the holder a proof for the parts that stay, chosen by JSON pointers; and
`selectiveDisclosureSuite.verify` checks it under the issuer's key. `isBaseProof` tells a base proof, which never goes to a
verifier. Proof values are CBOR as the Recommendation writes them, the key of each proof is a new P-256 key, and the package
reproduces the test vectors of the Recommendation byte for byte.

The suite serves any verifiable credential, a learning one or not; the package implements no other selective disclosure, such as
SD-JWT or BBS.

`maxBytes` and `maxTokens` of the document with its proof, and the bound of the runs of Hash N-Degree Quads, throw `LimitError` of `@interopkit/core`, with the name of the limit and its value; the error of the processor is the `cause` of what it throws.
