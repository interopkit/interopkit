/**
 * The refresh of a credential (1EdTech Verifiable Credential Refresh): getting the newer version from the refresh service,
 * and answering as the issuer's refresh service.
 *
 * @module @interopkit/achievement-credentials/refresh
 */
export { handleRefreshRequest, type RefreshHandlerOptions } from "./handle-refresh-request.js";
export { type RefreshOptions, refreshCredential } from "./refresh-credential.js";
