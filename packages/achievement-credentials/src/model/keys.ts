/**
 * The models of keys (OB B.6): a Multikey, a JWK and a JWK Set.
 *
 * @module
 */

/** A verification method that holds a public key in the Multikey form (OB B.6.1). */
export interface Multikey {
  /** The identifier of the verification method. */
  readonly id: string;
  /** The type of the verification method, which is `DataIntegrityProof` for the suites that Open Badges names. */
  readonly type?: string;
  /** The cryptosuite that the key serves, such as `eddsa-rdfc-2022`. */
  readonly cryptosuite: string;
  /** The entity that controls the key. */
  readonly controller?: string;
  /** The public key, encoded as a multicodec value and formatted as a multibase string. */
  readonly publicKeyMultibase: string;
}

/**
 * A JSON Web Key (OB B.6.2), whose parameters beyond those named here, such as `crv`, `x`, `y`, `n` and `e`, are carried as
 * they are.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc7517 | RFC 7517}
 */
export interface JWK {
  /** The key type, the family of the cryptographic algorithm, such as `RSA` or `EC`. */
  readonly kty: string;
  /** The intended use of the public key, such as `sig` for a signature or `enc` for encryption. */
  readonly use?: string;
  /** The operations for which the key is intended, such as `sign` or `verify`. */
  readonly key_ops?: string;
  /** The algorithm for which the key is intended, such as `RS256`. */
  readonly alg?: string;
  /** The key identifier, which matches a key of a set to a signature. */
  readonly kid?: string;
  /** The address of an X.509 public key certificate or certificate chain. */
  readonly x5u?: string;
  /** A chain of one or more PKIX certificates. */
  readonly x5c?: readonly string[];
  /** The base64url-encoded SHA-1 thumbprint of the X.509 certificate. */
  readonly x5t?: string;
  /** The base64url-encoded SHA-256 thumbprint of the X.509 certificate. */
  readonly x5t_S256?: string;
}

/** A set of JSON Web Keys (OB B.6.3), such as the keys that an issuer publishes. */
export interface JWKS {
  /** The keys. */
  readonly keys: readonly JWK[];
}
