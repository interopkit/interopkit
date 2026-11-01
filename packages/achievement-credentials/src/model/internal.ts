/**
 * What the other modules and the tests share of `model` and the package does not export.
 *
 * @module
 */
import type { CredentialApi } from "./api.js";

/** The path below the base of a service on which every endpoint of an API sits (OB 6.2, CLR 5.2). */
export const API_PATHS: Readonly<Record<CredentialApi, string>> = {
  badges: "/ims/ob/v3p0",
  clr: "/ims/clr/v2p0",
};

/**
 * The most characters of a credential, or of the profile of a user, that the package reads from a source it does not trust. The
 * readers collect every finding of a value and `JSON.parse` takes about forty times the text of small objects, so a value of
 * megabytes costs hundreds of times its size in memory. It is also the size that `verifyCredential` takes by default, so a
 * credential longer than this is one the package would not verify.
 */
export const MAX_CREDENTIAL_CHARACTERS = 1_048_576;
