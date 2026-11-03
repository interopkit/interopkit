/**
 * The platform role of LTI 1.3: what launches tools. The host keeps a message for a tool with `prepareToolLaunch` or
 * `prepareToolFrame`, whose URL its page opens in the tool's frame, and routes every request to the platform's origin to
 * `handlePlatformRequest`: the tool's authentication request, which receives the `id_token` of the kept message, the key set,
 * the token requests, the storage page of the client-side login, and the routes of the services whose stores the host gives:
 * the line items, results and scores of the Assignment and Grade Services over a `GradebookStore`, the members of a context over a
 * `RosterStore`, its groups and group sets over a `GroupStore`, the preferences records over a `PreferencesStore` and the Assessment
 * Control Service of a proctored attempt over an `AssessmentControl`. The host's route at the `deep_link_return_url` of a Deep
 * Linking request reads the tool's response with `readDeepLinkingResponse`, and its route at the `start_assessment_url` of a Start
 * Proctoring message reads the proctoring tool's Start Assessment message with `readStartAssessment`. With a `RegistrationStore`, the
 * handler serves Dynamic Registration: the OpenID configuration, the registration endpoint, which takes the token of
 * `buildRegistrationInitiation`, and the client configuration endpoint; `buildToolRegistration` turns a reviewed registration into the
 * registration of a tool.
 *
 * @module @interopkit/tool-integration/platform
 */
export { buildCapabilitiesScript, type CapabilitiesScript, type CapabilitiesScriptOptions } from "./capabilities.js";
export { buildPlatformEndpoints, type PlatformConfig, type PlatformEndpoints } from "./config.js";
export { type ReceivedDeepLinkingResponse, readDeepLinkingResponse } from "./deep-linking/response.js";
export { type PlatformFrame, prepareToolFrame, prepareToolLaunch } from "./login.js";
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
  PlatformDiscovery,
  PlatformLoginOptions,
  PlatformOptions,
  PlatformRequestOptions,
  RegistrationInitiationOptions,
  ToolMessageOptions,
} from "./options.js";
export type {
  AssessmentControl,
  GradebookStore,
  GroupStore,
  LaunchStore,
  PlatformServices,
  PreferencesStore,
  ReceivedScore,
  RegisteredTool,
  RegistrationRefusal,
  RegistrationStore,
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
export { type ReceivedStartAssessment, readStartAssessment } from "./proctoring/start-assessment.js";
export type { ToolRegistration } from "./registration.js";
export { buildRegistrationInitiation } from "./registration-flow/initiation.js";
export { buildToolRegistration, type RegistrationGrant } from "./registration-flow/tool-registration.js";
export { handlePlatformRequest } from "./router.js";
