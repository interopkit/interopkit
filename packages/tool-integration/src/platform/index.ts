/**
 * The platform role of LTI 1.3: the handlers that launch a tool. The host's page navigates a frame to the URL of
 * `ltiPlatformLogin`; the tool's authentication request reaches `ltiPlatformAuthorize`, which answers with a page that
 * posts the `id_token`; the tool fetches the key set from `platformJwks`, gets a token from `platformToken`, reads its line
 * item with `agsLineItem` and posts scores with `agsScores`. The tool keeps its `state` and `nonce` in the page of
 * `platformStorage`, which the host's page shows in a frame beside the tool's.
 *
 * @module @interopkit/tool-integration/platform
 */
export { agsLineItem, agsScores } from "./ags.js";
export { type AgsScore, readAgsScore } from "./ags-score.js";
export { ltiPlatformAuthorize } from "./authorize.js";
export { type PlatformConfig, type PlatformEndpoints, platformEndpoints } from "./config.js";
export { platformJwks } from "./jwks.js";
export { ltiPlatformFrame, ltiPlatformLogin, type PlatformFrame } from "./login.js";
export type {
  AgsScoresOptions,
  PlatformAuthorizeOptions,
  PlatformLoginOptions,
  PlatformOptions,
  PlatformStorageOptions,
  PlatformTokenOptions,
} from "./options.js";
export type { ToolRegistration } from "./registration.js";
export { platformStorage } from "./storage.js";
export { platformToken } from "./token.js";
export type { ToolLaunch } from "./tool-launch.js";
