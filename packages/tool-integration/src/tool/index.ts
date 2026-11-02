/**
 * The tool role of LTI 1.3: a tool that a learning platform launches.
 *
 * @remarks
 * The tool starts the OpenID Connect login (with a cookie, or with the platform's browser storage in an iframe), validates
 * the launch of every message type, serves its key set, answers a Deep Linking request, and calls the services of the platform
 * with `createServiceClient`: the line items, results and scores of the Assignment and Grade Services, with access tokens
 * that its signer asks for and that it reuses.
 *
 * @module @interopkit/tool-integration/tool
 */
export { type DeepLinkItem, type DeepLinkLineItem, deepLinkResponse } from "./deep-link.js";
export { type ServeToolJwksOptions, serveToolJwks } from "./jwks.js";
export { ltiLaunch } from "./launch.js";
export { ltiLogin } from "./login.js";
export type { LtiLaunchOptions, LtiLoginOptions, ToolOptions } from "./options.js";
export type { PlatformRegistration } from "./registration.js";
export type { Page } from "./services/access.js";
export { advanceScoreTimestamp, type GradesClient } from "./services/grades.js";
export type { ServiceClientOptions } from "./services/options.js";
export { createServiceClient, type ServiceClient } from "./services/parts.js";
export type { LoginRecord, LtiStore } from "./store.js";
