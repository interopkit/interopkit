/**
 * What the two roles of LTI share and the host also uses: the names and vocabularies of the messages, the one model of the
 * messages, the keys of a party, and the cache of the key sets of platforms.
 *
 * @module
 */

export type { SubmissionReview } from "./claims/index.js";
export {
  APPROVED_ALGORITHMS,
  CONTEXT_ROLES,
  CONTEXT_SUB_ROLES,
  CONTEXT_TYPES,
  canonicalizeContextType,
  canonicalizeRole,
  INSTITUTION_ROLES,
  type JwsAlgorithm,
  LTI_SYSTEM_ROLES,
  MESSAGE_TYPES,
  type MessageType,
  SCOPES,
  SYSTEM_ROLES,
} from "./claims/index.js";
export {
  CONTENT_ITEM_TYPES,
  type ContentItem,
  type FileItem,
  type HtmlItem,
  type ImageItem,
  type ItemBase,
  type ItemImage,
  type ItemLineItem,
  type ItemPeriod,
  type ItemWindow,
  type LinkItem,
  type LtiResourceLinkItem,
  type OtherContentItem,
} from "./content-items/index.js";
export {
  ACTIVITY_PROGRESS,
  type ActivityProgress,
  GRADING_PROGRESS,
  type GradingProgress,
  type LineItem,
  type LineItemInput,
  type LineItemQuery,
  type Result,
  type ResultQuery,
  type Score,
} from "./grades/index.js";
export type {
  Group,
  GroupContainer,
  GroupQuery,
  GroupSet,
  GroupSetContainer,
} from "./groups/index.js";
export { createJwksCache, type JwksCache, type JwksCacheOptions } from "./jwks.js";
export type { KeySet } from "./key-set.js";
export type {
  ActualUser,
  AssessmentControlClaim,
  ContextClaim,
  DeepLinkingRequestMessage,
  DeepLinkingResponseMessage,
  DeepLinkingSettings,
  EndAssessmentMessage,
  ForUser,
  GradesClaim,
  GroupsClaim,
  LaunchPresentation,
  LtiDeployment,
  LtiMessage,
  MessageBase,
  MessageServices,
  MigrationClaim,
  OrganizationClaim,
  OtherMessage,
  PlatformInstance,
  PreferencesClaim,
  ProctoringSettings,
  ResourceLink,
  ResourceLinkMessage,
  RosterClaim,
  StartAssessmentMessage,
  StartProctoringMessage,
  SubmissionReviewMessage,
  ToolMessage,
  ToolMessageBase,
  UserIdentity,
  VerifiedMigrationClaim,
} from "./message/index.js";
export type {
  PreferencesQuery,
  PreferencesRecord,
} from "./preferences/index.js";
export {
  ATTEMPT_STATUSES,
  type AttemptStatus,
  CONTROL_ACTIONS,
  type ControlAction,
  type ControlRequest,
  type ControlStatus,
} from "./proctoring/index.js";
export type {
  MessageSupported,
  PlatformConfiguration,
  PlatformLtiConfiguration,
  ToolConfiguration,
  ToolLtiConfiguration,
  ToolMessageConfiguration,
  ToolRegistrationResult,
} from "./registration/index.js";
export {
  type GroupEnrollment,
  MEMBER_STATUSES,
  type Member,
  type MemberQuery,
  type MemberStatus,
  type Membership,
  type MembershipContext,
} from "./roster/index.js";
