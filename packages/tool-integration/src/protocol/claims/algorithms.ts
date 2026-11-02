/**
 * The algorithms that sign the tokens of LTI, in the order of the Security Framework: RS256, RS384 and RS512 with an RSA key
 * of at least 2,048 bits, and ES256, ES384 and ES512 with an elliptic curve key on P-256, P-384 and P-521.
 *
 * @see {@link https://www.imsglobal.org/spec/security/v1p1#approved-jwt-signing-algorithms | Security Framework 1.1, section 7.2}
 */
export const APPROVED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"] as const;

/** An algorithm that signs the tokens of LTI. */
export type JwsAlgorithm = (typeof APPROVED_ALGORITHMS)[number];
