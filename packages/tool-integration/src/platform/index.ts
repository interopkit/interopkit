/**
 * The platform role of LTI 1.3: what launches tools. The host keeps a message for a tool with `ltiPlatformLogin` or
 * `ltiPlatformFrame`, whose URL its page opens in the tool's frame, and routes every request to the platform's origin to
 * `handlePlatformRequest`: the tool's authentication request, which receives the `id_token` of the kept message, the key set,
 * the token requests and the storage page of the client-side login.
 *
 * @module @interopkit/tool-integration/platform
 */
export { buildCapabilitiesScript, type CapabilitiesScript, type CapabilitiesScriptOptions } from "./capabilities.js";
export { buildPlatformEndpoints, type PlatformConfig, type PlatformEndpoints } from "./config.js";
export { ltiPlatformFrame, ltiPlatformLogin, type PlatformFrame } from "./login.js";
export type {
  DeepLinkingInputSettings,
  DeepLinkingRequestInput,
  EndAssessmentInput,
  MessageInput,
  MessageInputBase,
  ResourceLinkInput,
  StartProctoringInput,
} from "./messages/input.js";
export type { LaunchToCheck, PlatformLoginOptions, PlatformOptions, PlatformRequestOptions } from "./options.js";
export type { LaunchStore, Substitution } from "./ports.js";
export type { ToolRegistration } from "./registration.js";
export { handlePlatformRequest } from "./router.js";
