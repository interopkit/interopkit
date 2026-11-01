/**
 * The keys that verify credentials: resolving the key of a verification method or a `kid`, reading what an issuer publishes,
 * and checking that a key belongs to the issuer.
 *
 * @module
 */
export { createKeyResolver, type DidMethod, type KeyResolverOptions } from "./create-key-resolver.js";
export { type VerifyIssuerKeyOptions, verifyIssuerKey } from "./verify-issuer-key.js";
