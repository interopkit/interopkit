/**
 * The tool role of LTI 1.3: a tool that a learning platform launches.
 *
 * @remarks
 * The tool starts the OpenID Connect login (with a cookie, or with the platform's browser storage in an iframe), validates
 * the launch, answers a Deep Linking request, requests access tokens for the platform's services and publishes scores.
 *
 * @module @interopkit/tool-integration/tool
 */
export { type AccessToken, ltiAccessToken } from "./access-token.js";
export { type DeepLinkItem, type DeepLinkLineItem, deepLinkResponse } from "./deep-link.js";
export { ltiLaunch } from "./launch.js";
export type {
  AgsEndpoint,
  DeepLinkingLaunch,
  DeepLinkingSettings,
  LaunchBase,
  LtiDeployment,
  LtiLaunch,
  ResourceLink,
  ResourceLinkLaunch,
} from "./launch-model.js";
export { ltiLogin } from "./login.js";
export type { AccessTokenOptions, LtiLaunchOptions, LtiLoginOptions, ToolOptions } from "./options.js";
export { type AgsScoreInput, publishAgsScore } from "./publish-ags-score.js";
export type { PlatformRegistration } from "./registration.js";
export type { LoginRecord, LtiStore } from "./store.js";
