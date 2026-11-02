/**
 * What the two roles of LTI share and the host also uses: the names and vocabularies of the messages, the one model of the
 * messages, the keys of a party, and the cache of the key sets of platforms.
 *
 * @module
 */
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
