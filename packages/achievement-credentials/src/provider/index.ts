/**
 * The provider of the Open Badges API and the CLR Standard API: the resource server's handler over plain requests, a store of
 * credentials and a store of profiles.
 *
 * @module @interopkit/achievement-credentials/provider
 */
export { handleCredentialsRequest } from "./handle-request.js";
export type { CredentialsAccess, CredentialsProviderOptions } from "./options.js";
export type {
  CredentialList,
  CredentialStore,
  CredentialsPage,
  ProfileStore,
  ReceivedCredential,
  UpsertOutcome,
} from "./store.js";
