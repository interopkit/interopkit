import { DataError } from "@interopkit/core";
import {
  guardSchema,
  isRecord,
  type JsonObject,
  type JsonValue,
  jsonObjectSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import {
  type ActualUser,
  CONTROL_ACTIONS,
  type ContextClaim,
  type ControlAction,
  type DeepLinkingSettings,
  type ForUser,
  type LaunchPresentation,
  type MigrationClaim,
  type OrganizationClaim,
  type ProctoringSettings,
  type ResourceLink,
  type UserIdentity,
} from "../../protocol/index.js";
import { HTTPS_URL, IDENTIFIER, STRING_ARRAY, STRING_RECORD } from "../../protocol/internal.js";

/** What every message that the host launches carries: plain data that a store can keep, with no secret in it. */
export interface MessageInputBase {
  /** The client identifier of the tool. */
  readonly clientId: string;
  /** The deployment of the tool, one of the `deploymentIds` of its registration. */
  readonly deploymentId: string;
  /** The `target_link_uri`: an `https` URL on none of the origins of the platform. */
  readonly targetLinkUri: string;
  /** The user the message is about. Without a `subject` the launch is anonymous (LTI 1.3 Core section 5.3.6.1). */
  readonly user: UserIdentity;
  /**
   * The person acting, when an administrator impersonates the user (LTI 1.3 Core section 5.3.6.2).
   *
   * @defaultValue none
   */
  readonly actualUser?: ActualUser;
  /** The roles of the user in the context: empty, or with a role of the vocabularies of LTI 1.3 Core Appendix A. */
  readonly roles: readonly string[];
  /**
   * The users whom a mentor may access; the roles must hold the Mentor role (LTI 1.3 Core section 5.4.3).
   *
   * @defaultValue none
   */
  readonly roleScopeMentor?: readonly string[];
  /**
   * The context the message comes from, usually a course.
   *
   * @defaultValue none
   */
  readonly context?: ContextClaim;
  /**
   * The organization that supports the context.
   *
   * @defaultValue none
   */
  readonly organization?: OrganizationClaim;
  /**
   * How the platform presents the tool.
   *
   * @defaultValue none
   */
  readonly presentation?: LaunchPresentation;
  /**
   * The identifiers of the Learning Information Services, such as `person_sourcedid` (LTI 1.3 Core section 5.4.4).
   *
   * @defaultValue none
   */
  readonly lis?: Readonly<Record<string, string>>;
  /**
   * The custom properties of the link, by name; a value such as `$User.id` is substituted at authorization (LTI 1.3 Core
   * Appendix B).
   *
   * @defaultValue none
   */
  readonly custom?: Readonly<Record<string, string>>;
  /**
   * Claims of the host's vendor by the URL that names each (LTI 1.3 Core section 5.4.7).
   *
   * @defaultValue none
   */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
  /**
   * The LTI 1.1 migration claim, without its signature: `migrationSecret` gives the secret that signs the consumer key at
   * authorization, so that no secret is kept.
   *
   * @defaultValue none
   */
  readonly migration?: Omit<MigrationClaim, "oauthConsumerKeySign">;
  /**
   * The services that the message offers the tool; each needs the `context` of the message, and a service whose store
   * `handlePlatformRequest` does not have is not offered.
   *
   * @defaultValue none
   */
  readonly services?: MessageServicesInput;
}

/** The services that a message offers the tool. */
export interface MessageServicesInput {
  /**
   * The Assignment and Grade Services (AGS 3.1): the line item of the message, the container of the line items of the context,
   * or both.
   *
   * @defaultValue none
   */
  readonly grades?: {
    /**
     * The store's identifier of the line item of the message, which the claim names as `lineitem`.
     *
     * @defaultValue none
     */
    readonly lineItemId?: string;
    /** Whether the claim names the container of the line items of the context as `lineitems`. */
    readonly container: boolean;
  };
  /**
   * Names and Role Provisioning (NRPS 2.0 section 4.1): the claim names the members of the context, and of a resource link of it
   * with `rlid`.
   *
   * @defaultValue none
   */
  readonly roster?: true;
  /**
   * Context Groups (Context Groups 1.0 section 2.7.1.1): the claim names the groups of the context and, when `sets` is true, its
   * group sets.
   *
   * @defaultValue none
   */
  readonly groups?: {
    /** Whether the claim names the group sets of the context as `context_group_sets_url`. */
    readonly sets: boolean;
  };
  /**
   * The AfA PNP Connector (AfA PNP Connector 1.0, claims in LTI messages): the claim names the activities that have a record. It
   * needs no context, since the record of a user is below the host and not below a context.
   *
   * @defaultValue none
   */
  readonly preferences?: {
    /** The identifiers of the activities that have a record, such as the resource link or the line item. At least one. */
    readonly activityIds: readonly string[];
  };
  /**
   * The Assessment Control Service (Proctoring Services 1.0 section 4.2.2.6), which only a Start Proctoring message offers: the
   * claim names the service and the actions that the platform supports for the attempt. It needs no context.
   *
   * @defaultValue none
   */
  readonly control?: {
    /** The actions that the platform supports for the attempt, at least one, such as `["pause", "resume", "terminate"]`. */
    readonly actions: readonly ControlAction[];
  };
}

/** A launch of a resource link (`LtiResourceLinkRequest`, LTI 1.3 Core section 5). */
export interface ResourceLinkInput extends MessageInputBase {
  /** The message type. */
  readonly messageType: "LtiResourceLinkRequest";
  /** The link that is launched. */
  readonly resourceLink: ResourceLink;
}

/** The settings of a Deep Linking request as the host gives them: those of the claim, and the host's own data. */
export interface DeepLinkingInputSettings extends Omit<DeepLinkingSettings, "data"> {
  /**
   * The host's own data, which the platform seals into the `data` of the request with the settings, so that it comes back
   * after the response is verified. It is signed and not encrypted, so it holds no secret and no personal data.
   *
   * @defaultValue none
   */
  readonly data?: JsonObject;
}

/** A request to select content (`LtiDeepLinkingRequest`, Deep Linking 2.0 section 4.4). */
export interface DeepLinkingRequestInput extends MessageInputBase {
  /** The message type. */
  readonly messageType: "LtiDeepLinkingRequest";
  /** What the platform asks of the tool; `returnUrl` is the host's route that reads the response. */
  readonly settings: DeepLinkingInputSettings;
}

/** A launch from the gradebook to the work behind a result (`LtiSubmissionReviewRequest`, Submission Review 1.0). */
export interface SubmissionReviewInput extends MessageInputBase {
  /** The message type. */
  readonly messageType: "LtiSubmissionReviewRequest";
  /**
   * The resource link of the line item; absent for a line item of no resource link.
   *
   * @defaultValue none
   */
  readonly resourceLink?: ResourceLink;
  /** The user whose work is shown. */
  readonly forUser: ForUser;
  /** The services, which name the line item of the review in the grade services (Submission Review 1.0 section 2.5). */
  readonly services: MessageServicesInput & {
    /** The grade services, which name the line item of the review. */
    readonly grades: {
      /** The store's identifier of the line item of the review. */
      readonly lineItemId: string;
      /** Whether the claim names the container of the line items of the context as `lineitems`. */
      readonly container: boolean;
    };
  };
}

/** The message that sends a candidate to a proctoring tool (`LtiStartProctoring`, Proctoring Services 1.0 section 4.2). */
export interface StartProctoringInput extends MessageInputBase {
  /** The message type. */
  readonly messageType: "LtiStartProctoring";
  /** The assessment the candidate attempts. */
  readonly resourceLink: ResourceLink;
  /** The attempt of the candidate at the assessment, the first being 1. */
  readonly attemptNumber: number;
  /** The host's route that reads the Start Assessment message of the proctoring tool. */
  readonly startAssessmentUrl: string;
  /**
   * The proctoring settings.
   *
   * @defaultValue none
   */
  readonly proctoringSettings?: ProctoringSettings;
}

/** The message that closes a proctored attempt (`LtiEndAssessment`, Proctoring Services 1.0 section 4.4). */
export interface EndAssessmentInput extends MessageInputBase {
  /** The message type. */
  readonly messageType: "LtiEndAssessment";
  /** The attempt that ended. */
  readonly attemptNumber: number;
  /**
   * The assessment that was attempted.
   *
   * @defaultValue none
   */
  readonly resourceLink?: ResourceLink;
  /**
   * The proctoring settings.
   *
   * @defaultValue none
   */
  readonly proctoringSettings?: ProctoringSettings;
  /**
   * A message for the user, when the assessment closed on an error.
   *
   * @defaultValue none
   */
  readonly errorMessage?: string;
  /**
   * A message for the log, when the assessment closed on an error.
   *
   * @defaultValue none
   */
  readonly errorLog?: string;
}

/** What the host launches: a message that a platform sends, as plain data that a store can keep. It holds no secret. */
export type MessageInput =
  | ResourceLinkInput
  | DeepLinkingRequestInput
  | SubmissionReviewInput
  | StartProctoringInput
  | EndAssessmentInput;

const TEXT = v.optional(v.string());

const identityEntries = {
  name: TEXT,
  givenName: TEXT,
  familyName: TEXT,
  middleName: TEXT,
  email: TEXT,
  emailVerified: v.optional(v.boolean()),
  picture: TEXT,
  locale: TEXT,
};

const resourceLinkSchema = strictRecord({ id: IDENTIFIER, title: TEXT, description: TEXT });
const proctoringSettingsSchema = strictRecord({ data: TEXT });

const gradesEntry = strictRecord({ lineItemId: v.optional(nonEmptyStringSchema), container: v.boolean() });
/** The services beside the grade services, which every message may offer. */
const otherServicesEntries = {
  roster: v.optional(v.literal(true)),
  groups: v.optional(strictRecord({ sets: v.boolean() })),
  preferences: v.optional(strictRecord({ activityIds: v.pipe(v.array(nonEmptyStringSchema), v.minLength(1)) })),
  control: v.optional(strictRecord({ actions: v.pipe(v.array(v.picklist(CONTROL_ACTIONS)), v.minLength(1)) })),
};

const baseEntries = {
  clientId: nonEmptyStringSchema,
  deploymentId: IDENTIFIER,
  targetLinkUri: HTTPS_URL,
  user: strictRecord({ subject: v.optional(IDENTIFIER), ...identityEntries }),
  actualUser: v.optional(strictRecord({ id: IDENTIFIER, roles: v.optional(STRING_ARRAY), ...identityEntries })),
  roles: STRING_ARRAY,
  roleScopeMentor: v.optional(STRING_ARRAY),
  context: v.optional(strictRecord({ id: IDENTIFIER, label: TEXT, title: TEXT, type: v.optional(STRING_ARRAY) })),
  organization: v.optional(strictRecord({ id: IDENTIFIER, type: TEXT, name: TEXT, description: TEXT, url: TEXT })),
  presentation: v.optional(
    strictRecord({
      documentTarget: v.optional(v.picklist(["frame", "iframe", "window"])),
      height: v.optional(positiveIntegerSchema),
      width: v.optional(positiveIntegerSchema),
      returnUrl: v.optional(HTTPS_URL),
      locale: TEXT,
    }),
  ),
  lis: v.optional(STRING_RECORD),
  custom: v.optional(STRING_RECORD),
  extensions: v.optional(jsonObjectSchema),
  migration: v.optional(
    strictRecord({
      userId: TEXT,
      contextId: TEXT,
      toolConsumerInstanceGuid: TEXT,
      resourceLinkId: TEXT,
      oauthConsumerKey: nonEmptyStringSchema,
    }),
  ),
  services: v.optional(strictRecord({ grades: v.optional(gradesEntry), ...otherServicesEntries })),
};

const deepLinkingSettingsEntries = {
  returnUrl: HTTPS_URL,
  acceptTypes: STRING_ARRAY,
  acceptPresentationDocumentTargets: STRING_ARRAY,
  acceptMediaTypes: v.optional(STRING_ARRAY),
  acceptMultiple: v.optional(v.boolean()),
  acceptLineItem: v.optional(v.boolean()),
  autoCreate: v.optional(v.boolean()),
  title: TEXT,
  text: TEXT,
};

/** The settings of a Deep Linking request without the host's own data, as the sealed data of the request keeps them. */
export const deepLinkingSettingsSchema = strictRecord(deepLinkingSettingsEntries);

/** The attempt number of a proctored assessment: a whole number from 0 (Proctoring Services 1.0 section 4.2.1.6). */
const ATTEMPT_NUMBER = nonNegativeIntegerSchema;

const messageInputSchema = v.pipe(
  guardSchema(isRecord, "an object"),
  v.variant("messageType", [
    v.strictObject({
      ...baseEntries,
      messageType: v.literal("LtiResourceLinkRequest"),
      resourceLink: resourceLinkSchema,
    }),
    v.strictObject({
      ...baseEntries,
      messageType: v.literal("LtiDeepLinkingRequest"),
      settings: strictRecord({ ...deepLinkingSettingsEntries, data: v.optional(jsonObjectSchema) }),
    }),
    v.strictObject({
      ...baseEntries,
      messageType: v.literal("LtiSubmissionReviewRequest"),
      resourceLink: v.optional(resourceLinkSchema),
      forUser: strictRecord({
        userId: IDENTIFIER,
        personSourcedId: TEXT,
        givenName: TEXT,
        familyName: TEXT,
        name: TEXT,
        email: TEXT,
        roles: v.optional(STRING_ARRAY),
      }),
      services: strictRecord({
        grades: strictRecord({ lineItemId: nonEmptyStringSchema, container: v.boolean() }),
        ...otherServicesEntries,
      }),
    }),
    v.strictObject({
      ...baseEntries,
      messageType: v.literal("LtiStartProctoring"),
      resourceLink: resourceLinkSchema,
      attemptNumber: ATTEMPT_NUMBER,
      startAssessmentUrl: HTTPS_URL,
      proctoringSettings: v.optional(proctoringSettingsSchema),
    }),
    v.strictObject({
      ...baseEntries,
      messageType: v.literal("LtiEndAssessment"),
      attemptNumber: ATTEMPT_NUMBER,
      resourceLink: v.optional(resourceLinkSchema),
      proctoringSettings: v.optional(proctoringSettingsSchema),
      errorMessage: TEXT,
      errorLog: TEXT,
    }),
  ]),
);

/** The services whose URLs lie below the context of the message, with the word that names each in an error. */
const CONTEXT_SERVICES = [
  ["grades", "grade"],
  ["roster", "roster"],
  ["groups", "group"],
] as const;

/**
 * Reads a message that the host launches, or that the `LaunchStore` gave back, into a copy that shares nothing with it.
 *
 * @param value - The message.
 * @param label - Names the message in the error, such as `The message`.
 * @throws `DataError` that names the path of the first invalid member, or when the message offers a service without its
 * context, or the Assessment Control Service in a message that is not a Start Proctoring message.
 */
export function readMessageInput(value: unknown, label: string): MessageInput {
  const message = parseWith(messageInputSchema, value, label);
  const services: MessageServicesInput | undefined = message.services;
  const names = CONTEXT_SERVICES.filter(([key]) => services?.[key] !== undefined).map(([, name]) => name);
  if (names.length > 0 && message.context === undefined) {
    throw new DataError(`${label} offers the ${names.join(" and ")} services, which need its context.`);
  }
  if (services?.control !== undefined && message.messageType !== "LtiStartProctoring") {
    throw new DataError(
      `${label} offers the Assessment Control Service, which only a Start Proctoring message carries, in a message of the type ${message.messageType}.`,
    );
  }
  return message;
}
