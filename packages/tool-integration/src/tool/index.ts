/**
 * The tool role of LTI 1.3: a tool that a learning platform launches.
 *
 * @remarks
 * The tool starts the OpenID Connect login (with a cookie, or with the platform's browser storage in an iframe), validates
 * the launch of every message type, serves its key set, answers a Deep Linking request with `buildDeepLinkingResponse`, and calls
 * the services of the platform with `createServiceClient`: the line items, results and scores of the Assignment and Grade
 * Services, the members of a context, its groups, the preferences record of a user and the Assessment Control Service of a
 * proctored attempt, with access tokens that its signer asks for and that it reuses. A proctoring tool sends the candidate back to
 * start the assessment with `buildStartAssessmentPage`. A tool registers itself with a platform through Dynamic Registration:
 * `readRegistrationInitiation`, `discoverPlatform`, `registerTool`, `buildPlatformRegistration` and `buildRegistrationClosePage`, and
 * reads and changes its registration later through the same service client.
 *
 * @module @interopkit/tool-integration/tool
 */
export { buildDeepLinkingResponse, type DeepLinkingResponseInput } from "./deep-linking.js";
export { type ServeToolJwksOptions, serveToolJwks } from "./jwks.js";
export { handleLaunch } from "./launch.js";
export { handleLogin } from "./login.js";
export type { LtiLaunchOptions, LtiLoginOptions, ToolOptions } from "./options.js";
export { buildStartAssessmentPage, type StartAssessmentInput } from "./proctoring/start-assessment.js";
export type { PlatformRegistration } from "./registration.js";
export { buildRegistrationClosePage } from "./registration-flow/close-page.js";
export { discoverPlatform } from "./registration-flow/discover.js";
export { type RegistrationInitiation, readRegistrationInitiation } from "./registration-flow/initiation.js";
export type { DiscoverPlatformOptions, RegisterToolOptions } from "./registration-flow/options.js";
export {
  buildPlatformRegistration,
  type PlatformRegistrationInput,
} from "./registration-flow/platform-registration.js";
export { registerTool } from "./registration-flow/register.js";
export type { ToolConfigurationInput } from "./registration-flow/tool-configuration.js";
export type { Page } from "./services/access.js";
export type { ControlClient } from "./services/control.js";
export { advanceScoreTimestamp, type GradesClient } from "./services/grades.js";
export type { GroupsClient } from "./services/groups.js";
export type { MemberPage, MembersClient } from "./services/members.js";
export type { ServiceClientOptions } from "./services/options.js";
export { createServiceClient, type ServiceClient } from "./services/parts.js";
export type { PreferencesClient } from "./services/preferences.js";
export type { RegistrationClient } from "./services/registration.js";
export type { TokenStore } from "./services/token-store.js";
export type { LoginRecord, LtiStore } from "./store.js";
