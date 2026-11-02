/**
 * The platform role of LTI 1.3: what launches tools. The host keeps a message for a tool with `ltiPlatformLogin` or
 * `ltiPlatformFrame`, whose URL its page opens in the tool's frame, and routes every request to the platform's origin to
 * `handlePlatformRequest`: the tool's authentication request, which receives the `id_token` of the kept message, the key set,
 * the token requests, the storage page of the client-side login, and the routes of the services whose stores the host gives:
 * the line items, results and scores of the Assignment and Grade Services over a `GradebookStore`, the members of a context over a
 * `RosterStore`, its groups and group sets over a `GroupStore` and the preferences records over a `PreferencesStore`. The host's route at the
 * `deep_link_return_url` of a Deep Linking request reads the tool's response with `readDeepLinkingResponse`.
 *
 * @module @interopkit/tool-integration/platform
 */
export { buildCapabilitiesScript, type CapabilitiesScript, type CapabilitiesScriptOptions } from "./capabilities.js";
export { buildPlatformEndpoints, type PlatformConfig, type PlatformEndpoints } from "./config.js";
export { type ReceivedDeepLinkingResponse, readDeepLinkingResponse } from "./deep-linking/response.js";
export { ltiPlatformFrame, ltiPlatformLogin, type PlatformFrame } from "./login.js";
export type {
  DeepLinkingInputSettings,
  DeepLinkingRequestInput,
  EndAssessmentInput,
  MessageInput,
  MessageInputBase,
  MessageServicesInput,
  ResourceLinkInput,
  StartProctoringInput,
  SubmissionReviewInput,
} from "./messages/input.js";
export type {
  LaunchToCheck,
  PlatformLoginOptions,
  PlatformOptions,
  PlatformRequestOptions,
  ToolMessageOptions,
} from "./options.js";
export type {
  GradebookStore,
  GroupStore,
  LaunchStore,
  PlatformServices,
  PreferencesStore,
  ReceivedScore,
  RosterStore,
  ServiceCaller,
  StoredLineItem,
  StoredResult,
  StoreGroupQuery,
  StoreLineItemQuery,
  StoreMemberPage,
  StoreMemberQuery,
  StorePage,
  StoreResultQuery,
  Substitution,
} from "./ports.js";
export type { ToolRegistration } from "./registration.js";
export { handlePlatformRequest } from "./router.js";
