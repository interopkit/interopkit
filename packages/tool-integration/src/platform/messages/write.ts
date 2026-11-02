import type {
  AssessmentControlClaim,
  MessageServices,
  MigrationClaim,
  PlatformInstance,
} from "../../protocol/index.js";
import { LTI_VERSION, type MessageToWrite } from "../../protocol/internal.js";
import type { MessageInput } from "./input.js";

/** The claims that the services write into a message: those of `services`, and the Assessment Control Service of a Start Proctoring message. */
export interface ServiceClaims extends MessageServices {
  /** The Assessment Control Service (Proctoring Services 1.0 section 4.2.2.6). */
  readonly assessmentControl?: AssessmentControlClaim;
}

/** What the platform adds to a message of the host when it issues it. */
export interface Issued {
  /** The issuer of the platform. */
  readonly issuer: string;
  /** The instance of the platform, the `tool_platform` claim. */
  readonly instance?: PlatformInstance | undefined;
  /** The custom properties, substituted. */
  readonly custom: ReadonlyMap<string, string>;
  /** The migration claim with the signature of its consumer key, when the host gave the secret. */
  readonly migration?: MigrationClaim | undefined;
  /** The claims of the services that the message offers. */
  readonly services?: ServiceClaims | undefined;
  /** The sealed `data` of a Deep Linking request, or the sealed `session_data` of a Start Proctoring message. */
  readonly sealed?: string | undefined;
}

/**
 * Returns the model of a message of the host as `writeMessage` takes it, with what the platform adds: the issuer, the version,
 * the instance, the substituted custom properties, the signed migration claim and the sealed data.
 */
export function toWrite(message: MessageInput, issued: Issued): MessageToWrite {
  const { assessmentControl, ...services } = issued.services ?? {};
  const base = {
    issuer: issued.issuer,
    clientId: message.clientId,
    deploymentId: message.deploymentId,
    version: LTI_VERSION,
    targetLinkUri: message.targetLinkUri,
    user: message.user,
    actualUser: message.actualUser,
    roles: message.roles,
    roleScopeMentor: message.roleScopeMentor,
    context: message.context,
    organization: message.organization,
    platform: issued.instance,
    presentation: message.presentation,
    lis: message.lis,
    custom: issued.custom,
    migration: issued.migration ?? message.migration,
    extensions: message.extensions,
    services,
  };
  switch (message.messageType) {
    case "LtiResourceLinkRequest":
      return { ...base, messageType: message.messageType, resourceLink: message.resourceLink };
    case "LtiSubmissionReviewRequest":
      return {
        ...base,
        messageType: message.messageType,
        resourceLink: message.resourceLink,
        forUser: message.forUser,
      };
    case "LtiDeepLinkingRequest":
      return { ...base, messageType: message.messageType, settings: { ...message.settings, data: issued.sealed } };
    case "LtiStartProctoring":
      return {
        ...base,
        messageType: message.messageType,
        resourceLink: message.resourceLink,
        attemptNumber: message.attemptNumber,
        startAssessmentUrl: message.startAssessmentUrl,
        sessionData: issued.sealed ?? "",
        assessmentControl,
        proctoringSettings: message.proctoringSettings,
      };
    case "LtiEndAssessment":
      return {
        ...base,
        messageType: message.messageType,
        attemptNumber: message.attemptNumber,
        resourceLink: message.resourceLink,
        proctoringSettings: message.proctoringSettings,
        errorMessage: message.errorMessage,
        errorLog: message.errorLog,
      };
  }
}
