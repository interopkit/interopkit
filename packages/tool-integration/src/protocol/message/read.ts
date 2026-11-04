import { describe, jsonObjectSchema } from "@interopkit/core/checks";
import { LtiError } from "../../errors.js";
import {
  BOOLEAN,
  CLAIM,
  type Claims,
  CUSTOM_RECORD,
  HTTPS_URL,
  IDENTIFIER,
  LTI_VERSION,
  optional,
  PLATFORM_MESSAGE_TYPES,
  type ResourceLink,
  required,
  requiredFrom,
  resourceLinkSchema,
  STRING,
  STRING_ARRAY,
  TOOL_MESSAGE_TYPES,
} from "../claims/index.js";
import type {
  DeepLinkingResponseMessage,
  LtiMessage,
  MessageBase,
  MessageServices,
  StartAssessmentMessage,
  ToolMessage,
} from "./model.js";
import {
  ATTEMPT_NUMBER,
  actualUserSchema,
  assessmentControlSchema,
  CONTENT_ITEMS,
  contextSchema,
  deepLinkingSettingsSchema,
  forUserSchema,
  gradesSchema,
  groupsSchema,
  lisSchema,
  migrationSchema,
  organizationSchema,
  platformInstanceSchema,
  preferencesSchema,
  presentationSchema,
  proctoringSettingsSchema,
  rosterSchema,
  userSchema,
  verifiedUserSchema,
} from "./parts.js";

const OWNER = "The id_token";

const TOOL_TYPES: readonly string[] = TOOL_MESSAGE_TYPES;

/**
 * What the reader knows from the verification and the registration, and checks the claims against.
 *
 * @typeParam TOther - The message types beyond the modeled ones that are accepted.
 */
export interface ReadMessageOptions<TOther extends string = never> {
  /** The issuer of the platform. */
  readonly issuer: string;
  /** The client identifier of the tool at the platform. */
  readonly clientId: string;
  /** The deployments of the registration: the `deployment_id` must be one of them. */
  readonly deploymentIds: readonly string[];
  /**
   * The values of the `version` claim that are accepted.
   *
   * @defaultValue `["1.3.0"]`
   */
  readonly versions?: readonly string[];
  /**
   * The message types beyond the five modeled ones that are read as `OtherMessage`.
   *
   * @defaultValue none
   */
  readonly otherMessageTypes?: readonly TOther[];
}

/** Reads the version and the deployment of a message, which both directions check the same way. */
function readVersion(claims: Claims, versions: readonly string[]): string {
  const version = required(claims, CLAIM.version, OWNER, STRING);
  if (!versions.includes(version)) {
    throw new LtiError(
      `The LTI version of the message must be one of ${versions.map(describe).join(", ")}, found ${describe(version)}.`,
      "version-unsupported",
    );
  }
  return version;
}

/** Reads the deployment of a message and checks that the registration lists it. */
function readDeployment(claims: Claims, deploymentIds: readonly string[]): string {
  const deploymentId = required(claims, CLAIM.deploymentId, OWNER, IDENTIFIER);
  if (!deploymentIds.includes(deploymentId)) {
    throw new LtiError(
      `The deployment ${describe(deploymentId)} is not one of the deployments of the registration.`,
      "deployment-unknown",
    );
  }
  return deploymentId;
}

/** Reads the service claims that a message carries. */
function readServices(claims: Claims): MessageServices {
  return {
    grades: optional(claims, CLAIM.agsEndpoint, OWNER, gradesSchema),
    roster: optional(claims, CLAIM.namesRoleService, OWNER, rosterSchema),
    groups: optional(claims, CLAIM.groupsService, OWNER, groupsSchema),
    preferences: optional(claims, CLAIM.preferencesService, OWNER, preferencesSchema),
  };
}

/** Reads the claims that every message of a platform has. */
function readBase(claims: Claims, options: ReadMessageOptions<string>): MessageBase {
  const { issuer, clientId, deploymentIds, versions = [LTI_VERSION] } = options;
  const version = readVersion(claims, versions);
  const migration = optional(claims, CLAIM.migration, OWNER, migrationSchema);
  return {
    issuer,
    clientId,
    deploymentId: readDeployment(claims, deploymentIds),
    version,
    targetLinkUri: required(claims, CLAIM.targetLinkUri, OWNER, HTTPS_URL),
    user: requiredFrom(claims, OWNER, userSchema),
    actualUser: optional(claims, CLAIM.actualUser, OWNER, actualUserSchema),
    roles: required(claims, CLAIM.roles, OWNER, STRING_ARRAY),
    roleScopeMentor: optional(claims, CLAIM.roleScopeMentor, OWNER, STRING_ARRAY),
    context: optional(claims, CLAIM.context, OWNER, contextSchema),
    organization: optional(claims, CLAIM.organization, OWNER, organizationSchema),
    platform: optional(claims, CLAIM.platformInstance, OWNER, platformInstanceSchema),
    presentation: optional(claims, CLAIM.launchPresentation, OWNER, presentationSchema),
    lis: optional(claims, CLAIM.lis, OWNER, lisSchema),
    custom: optional(claims, CLAIM.custom, OWNER, CUSTOM_RECORD) ?? {},
    services: readServices(claims),
    // Whether the signature matches the host's LTI 1.1 secret is for `verifyMigration`, which needs the secret.
    migration: migration && { ...migration, verified: false },
    claims: requiredFrom(claims, OWNER, jsonObjectSchema),
  };
}

/**
 * Reads the claims of a verified token that a platform sent into a message (LTI 1.3 Core section 5, Deep Linking 2.0 section
 * 4.4, Submission Review 1.0 section 2, Proctoring Services 1.0 sections 4.2 and 4.4): the message type, a version and a
 * deployment that the registration accepts, and the claims of that message type. A claim that the model does not name is
 * kept in `claims`.
 *
 * @remarks
 * The roles, context types and other vocabularies are read as sent, whatever they are: the receiver ignores what it does not
 * understand, and Canvas sends the context type `Account`. A `null` string is read as absent, as Canvas sends it.
 *
 * @param claims - The claims of a token whose signature, issuer, audience, times and nonce were verified.
 * @param options - The registration and the versions and message types to accept.
 * @returns The message.
 * @throws `LtiError` with the reason of the failed check: `message-type-unsupported`, `version-unsupported`,
 * `deployment-unknown`, `claim-missing` or `claim-invalid`.
 */
export function readMessage<TOther extends string = never>(
  claims: Claims,
  options: ReadMessageOptions<TOther>,
): LtiMessage<TOther> {
  const { otherMessageTypes = [] } = options;
  const messageType = required(claims, CLAIM.messageType, OWNER, STRING);
  const type =
    PLATFORM_MESSAGE_TYPES.find((modeled) => modeled === messageType) ??
    otherMessageTypes.find((other) => other === messageType);
  if (type === undefined) {
    throw new LtiError(
      `The message type must be one of ${[...PLATFORM_MESSAGE_TYPES, ...otherMessageTypes].map(describe).join(", ")}, found ${describe(messageType)}.`,
      "message-type-unsupported",
    );
  }
  const base = readBase(claims, options);
  const resourceLink = (): ResourceLink => required(claims, CLAIM.resourceLink, OWNER, resourceLinkSchema);
  switch (type) {
    case "LtiResourceLinkRequest":
      return { ...base, messageType: "LtiResourceLinkRequest", resourceLink: resourceLink() };
    case "LtiDeepLinkingRequest":
      return {
        ...base,
        messageType: "LtiDeepLinkingRequest",
        settings: required(claims, CLAIM.deepLinkingSettings, OWNER, deepLinkingSettingsSchema),
      };
    case "LtiSubmissionReviewRequest":
      if (base.services.grades?.lineitem === undefined) {
        throw new LtiError(
          "A submission review request must name its line item in the lineitem of the grade services claim (Submission Review 1.0 section 2.5).",
          "claim-missing",
        );
      }
      return {
        ...base,
        messageType: "LtiSubmissionReviewRequest",
        resourceLink: optional(claims, CLAIM.resourceLink, OWNER, resourceLinkSchema),
        forUser: required(claims, CLAIM.forUser, OWNER, forUserSchema),
      };
    case "LtiStartProctoring":
      return {
        ...base,
        messageType: "LtiStartProctoring",
        resourceLink: resourceLink(),
        attemptNumber: required(claims, CLAIM.attemptNumber, OWNER, ATTEMPT_NUMBER),
        startAssessmentUrl: required(claims, CLAIM.startAssessmentUrl, OWNER, HTTPS_URL),
        sessionData: required(claims, CLAIM.sessionData, OWNER, STRING),
        assessmentControl: optional(claims, CLAIM.assessmentControl, OWNER, assessmentControlSchema),
        proctoringSettings: optional(claims, CLAIM.proctoringSettings, OWNER, proctoringSettingsSchema),
      };
    case "LtiEndAssessment":
      return {
        ...base,
        messageType: "LtiEndAssessment",
        attemptNumber: required(claims, CLAIM.attemptNumber, OWNER, ATTEMPT_NUMBER),
        resourceLink: optional(claims, CLAIM.resourceLink, OWNER, resourceLinkSchema),
        proctoringSettings: optional(claims, CLAIM.proctoringSettings, OWNER, proctoringSettingsSchema),
        errorMessage: optional(claims, CLAIM.proctoringErrorMessage, OWNER, STRING),
        errorLog: optional(claims, CLAIM.proctoringErrorLog, OWNER, STRING),
      };
    default:
      return { ...base, messageType: type };
  }
}

/** What the reader of a message of a tool knows from the verification and the registration. */
export interface ReadToolMessageOptions {
  /** The issuer of the platform, which the token names as its audience. */
  readonly issuer: string;
  /** The client identifier of the tool, which is the issuer of the token. */
  readonly clientId: string;
  /** The deployments of the registration: the `deployment_id` must be one of them. */
  readonly deploymentIds: readonly string[];
  /**
   * The values of the `version` claim that are accepted.
   *
   * @defaultValue `["1.3.0"]`
   */
  readonly versions?: readonly string[];
}

/**
 * Reads the claims of a verified token that a tool sent into a message (Deep Linking 2.0 section 4.5, Proctoring Services 1.0
 * section 4.3): the message type, a version and a deployment that the registration accepts, and the claims of that message
 * type.
 *
 * @param claims - The claims of a token whose signature, issuer, audience, times and nonce were verified.
 * @param options - The registration and the versions to accept.
 * @returns The message.
 * @throws `LtiError` with the reason of the failed check: `message-type-unsupported`, `version-unsupported`,
 * `deployment-unknown`, `claim-missing` or `claim-invalid`.
 */
export function readToolMessage(claims: Claims, options: ReadToolMessageOptions): ToolMessage {
  const { issuer, clientId, deploymentIds, versions = [LTI_VERSION] } = options;
  const messageType = required(claims, CLAIM.messageType, OWNER, STRING);
  if (!TOOL_TYPES.includes(messageType)) {
    throw new LtiError(
      `The message type must be one of ${TOOL_TYPES.map(describe).join(", ")}, found ${describe(messageType)}.`,
      "message-type-unsupported",
    );
  }
  const version = readVersion(claims, versions);
  const base = {
    issuer,
    clientId,
    deploymentId: readDeployment(claims, deploymentIds),
    version,
    claims: requiredFrom(claims, OWNER, jsonObjectSchema),
  };
  if (messageType === "LtiDeepLinkingResponse") {
    const items = optional(claims, CLAIM.contentItems, OWNER, CONTENT_ITEMS) ?? [];
    const response: DeepLinkingResponseMessage = {
      ...base,
      messageType,
      data: optional(claims, CLAIM.data, OWNER, STRING),
      items,
      message: optional(claims, CLAIM.message, OWNER, STRING),
      log: optional(claims, CLAIM.log, OWNER, STRING),
      errorMessage: optional(claims, CLAIM.errorMessage, OWNER, STRING),
      errorLog: optional(claims, CLAIM.errorLog, OWNER, STRING),
    };
    return response;
  }
  const assessment: StartAssessmentMessage = {
    ...base,
    messageType: "LtiStartAssessment",
    sessionData: required(claims, CLAIM.sessionData, OWNER, STRING),
    resourceLink: required(claims, CLAIM.resourceLink, OWNER, resourceLinkSchema),
    attemptNumber: required(claims, CLAIM.attemptNumber, OWNER, ATTEMPT_NUMBER),
    endAssessmentReturn: optional(claims, CLAIM.endAssessmentReturn, OWNER, BOOLEAN) ?? false,
    verifiedUser: optional(claims, CLAIM.verifiedUser, OWNER, verifiedUserSchema),
  };
  return assessment;
}
