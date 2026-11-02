/**
 * LTI 1.3 for learning platforms and tools: the error of the protocol, the names and vocabularies of its messages, the one
 * model of the messages that a platform and a tool send, the keys of a party, and the cache of key sets. The requests and
 * answers that its handlers take and return are in `@interopkit/core/http`. The tool role is in
 * `@interopkit/tool-integration/tool`, and the platform role in `@interopkit/tool-integration/platform`.
 *
 * @module @interopkit/tool-integration
 */
export { LtiError } from "./errors.js";
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
  JwksCache,
  JwksCacheOptions,
  JwsAlgorithm,
  KeySet,
  LaunchPresentation,
  LtiDeployment,
  LtiMessage,
  MessageBase,
  MessageServices,
  MessageType,
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
} from "./protocol/index.js";
export {
  APPROVED_ALGORITHMS,
  CONTEXT_ROLES,
  CONTEXT_SUB_ROLES,
  CONTEXT_TYPES,
  canonicalizeContextType,
  canonicalizeRole,
  createJwksCache,
  INSTITUTION_ROLES,
  LTI_SYSTEM_ROLES,
  MESSAGE_TYPES,
  SCOPES,
  SYSTEM_ROLES,
} from "./protocol/index.js";
