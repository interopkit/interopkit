/**
 * The tool role of LTI 1.3: a tool that a learning platform launches.
 *
 * @remarks
 * The tool starts the OpenID Connect login (with a cookie, or with the platform's browser storage in an iframe), validates
 * the launch of every message type, serves its key set, answers a Deep Linking request and publishes scores with access
 * tokens that its signer asks for.
 *
 * @module @interopkit/tool-integration/tool
 */
export { type DeepLinkItem, type DeepLinkLineItem, deepLinkResponse } from "./deep-link.js";
export { type ServeToolJwksOptions, serveToolJwks } from "./jwks.js";
export { ltiLaunch } from "./launch.js";
export { ltiLogin } from "./login.js";
export type { LtiLaunchOptions, LtiLoginOptions, PublishAgsScoreOptions, ToolOptions } from "./options.js";
export { type AgsScoreInput, publishAgsScore } from "./publish-ags-score.js";
export type { PlatformRegistration } from "./registration.js";
export type { LoginRecord, LtiStore } from "./store.js";
