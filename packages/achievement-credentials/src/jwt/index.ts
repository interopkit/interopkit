/**
 * Credentials as JSON Web Tokens: signing a credential as Open Badges 8.2 asks, and reading one from a compact JWS.
 *
 * @module
 */
export type { JwtReadOptions, JwtSignOptions } from "./options.js";
export { readCredentialJwt } from "./read-credential-jwt.js";
export { signCredentialJwt } from "./sign-credential-jwt.js";
