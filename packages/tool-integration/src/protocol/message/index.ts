/**
 * The one model of the messages of LTI: what a platform sends and a tool reads, and what a tool sends and a platform reads.
 * `readMessage` and `readToolMessage` take the claims of a verified token into the model; `writeMessage` and
 * `writeToolMessage` take the model to claims.
 *
 * @module
 */
export { signConsumerKey, verifyMigration } from "./migration.js";
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
} from "./model.js";
export { readMessage, readToolMessage } from "./read.js";
export { type MessageToWrite, type ToolMessageToWrite, writeMessage, writeToolMessage } from "./write.js";
