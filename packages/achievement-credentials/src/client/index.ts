/**
 * The client of the Open Badges API and the CLR Standard API: service discovery, the credentials and the profile of a user,
 * and the status that a server answers an error with.
 *
 * @module @interopkit/achievement-credentials/client
 */
export { type CredentialsClient, createCredentialsClient } from "./client.js";
export type { CredentialsClientOptions } from "./config.js";
export { type DiscoverOptions, discoverService, type ServiceDescription } from "./discovery.js";
export { readStatusInfo, type StatusDetail } from "./status.js";
