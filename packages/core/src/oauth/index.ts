/**
 * OAuth 2.0 clients on `oauth4webapi`: the client credentials, authorization code with PKCE, refresh token and revocation
 * calls, dynamic client registration, client authentication by secret, by `private_key_jwt` over a `Signer`, and none, and a
 * cache that shares one token among callers. Every request goes through `requestService`.
 *
 * @module @interopkit/core/oauth
 */
export type { AccessToken } from "./access-token.js";
export {
  type AuthorizationRequestParameters,
  authorizationRequest,
  exchangeCode,
  type PendingAuthorization,
} from "./authorization-code.js";
export type { ClientAuthentication, OAuthClient } from "./client.js";
export { clientCredentialsToken } from "./client-credentials.js";
export { refreshAccessToken } from "./refresh.js";
export { type ClientMetadata, type RegisteredClient, registerClient } from "./registration.js";
export type { OAuthCallOptions } from "./request.js";
export { revokeToken } from "./revocation.js";
export type { AuthorizationServer } from "./server.js";
export { createTokenCache, type TokenCacheOptions } from "./token-cache.js";
