/**
 * Verification of credentials of Open Badges 3.0 and CLR 2.0: the algorithms of Open Badges 9 and CLR 8, with the issuer's hold on
 * every key, for a credential, its endorsements and the credentials of a CLR.
 *
 * @module @interopkit/achievement-credentials/verify
 */
export type { KnownRecipient, VerifyOptions } from "./options.js";
export { verifyCredential } from "./verify-credential.js";
