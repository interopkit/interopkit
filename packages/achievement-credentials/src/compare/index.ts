/**
 * Ways to look at credentials: whether two are the same credential, which is the newer, and what a wallet shows of one.
 *
 * @module
 */
export { type CredentialSummary, summarizeCredential } from "./credential-summary.js";
export { isSameCredential } from "./is-same-credential.js";
export { selectNewerCredential } from "./select-newer-credential.js";
