/** How a `CryptoKey` signs with one JOSE algorithm: the key it needs and the parameters of the call to Web Crypto. */
export interface KeySpec {
  /** The `name` of the algorithm of the key. */
  readonly name: string;
  /** The hash that an RSA key was imported with. */
  readonly hash?: string;
  /** The curve of the key, for ECDSA. */
  readonly curve?: string;
  /** The first argument of `crypto.subtle.sign`. */
  readonly params: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
}

/** What is known of the signature of one JOSE algorithm. */
export interface JwsAlgorithm {
  /** The bytes of a signature when the algorithm fixes them: the R and S of ECDSA, each as long as the curve's order. */
  readonly signatureBytes?: number;
  /** How a `CryptoKey` signs with it, when Web Crypto can. */
  readonly key?: KeySpec;
}

const rsa = (hash: string): KeySpec => ({
  name: "RSASSA-PKCS1-v1_5",
  hash: `SHA-${hash}`,
  params: { name: "RSASSA-PKCS1-v1_5" },
});
const pss = (hash: string, saltBytes: number): KeySpec => ({
  name: "RSA-PSS",
  hash: `SHA-${hash}`,
  params: { name: "RSA-PSS", saltLength: saltBytes },
});
const ecdsa = (hash: string, curve: string, signatureBytes: number): JwsAlgorithm => ({
  signatureBytes,
  key: { name: "ECDSA", curve, params: { name: "ECDSA", hash: `SHA-${hash}` } },
});

/**
 * The JOSE algorithms of a signature by a private key (RFC 7518 sections 3.3 to 3.5, RFC 8037 and RFC 8812), by name. `none`
 * and the HMAC algorithms are not here: a signer holds a private key.
 */
export const JWS_ALGORITHMS: ReadonlyMap<string, JwsAlgorithm> = new Map<string, JwsAlgorithm>([
  ["RS256", { key: rsa("256") }],
  ["RS384", { key: rsa("384") }],
  ["RS512", { key: rsa("512") }],
  ["PS256", { key: pss("256", 32) }],
  ["PS384", { key: pss("384", 48) }],
  ["PS512", { key: pss("512", 64) }],
  ["ES256", ecdsa("256", "P-256", 64)],
  ["ES384", ecdsa("384", "P-384", 96)],
  ["ES512", ecdsa("512", "P-521", 132)],
  // Web Crypto has no secp256k1, so a signer with this algorithm comes from a KMS, not from `signerFromCryptoKey`.
  ["ES256K", { signatureBytes: 64 }],
  ["EdDSA", { key: { name: "Ed25519", params: { name: "Ed25519" } } }],
]);
