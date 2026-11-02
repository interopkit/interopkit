import type { JsonObject, JsonValue } from "@interopkit/core/checks";
import type { ResourceLink } from "../claims/index.js";

/** The deployment that a message belongs to: the platform, the tool's client at the platform, and the deployment. */
export interface LtiDeployment {
  /** The issuer identifier of the platform (`iss`). */
  readonly issuer: string;
  /** The client identifier of the tool at the platform. */
  readonly clientId: string;
  /** The deployment of the tool at the platform (LTI 1.3 Core section 5.3.3). */
  readonly deploymentId: string;
}

/** The identity claims of a user, as OpenID Connect names them (LTI 1.3 Core section 5.3.6). */
export interface UserIdentity {
  /** The identifier of the user at the platform (`sub`); absent in an anonymous launch. */
  readonly subject?: string;
  /** The full name of the user in displayable form. */
  readonly name?: string;
  /** The given names of the user. */
  readonly givenName?: string;
  /** The family names of the user. */
  readonly familyName?: string;
  /** The middle names of the user. */
  readonly middleName?: string;
  /** The preferred email address of the user. */
  readonly email?: string;
  /** Whether the platform verified the email address. */
  readonly emailVerified?: boolean;
  /** The address of a picture of the user. */
  readonly picture?: string;
  /** The preferred locale of the user, as a language tag. */
  readonly locale?: string;
}

/** The person who acts when an administrator impersonates another user (LTI 1.3 Core section 5.3.6.2). */
export interface ActualUser extends Omit<UserIdentity, "subject"> {
  /** The identifier of the person acting; the `sub` of the message names the user acted as. */
  readonly id: string;
  /** The roles of the person acting in the context, as the `roles` claim has them. */
  readonly roles?: readonly string[];
}

/** The context a message comes from, usually a course (LTI 1.3 Core section 5.4.1). */
export interface ContextClaim {
  /** The identifier of the context within the deployment. */
  readonly id: string;
  /** The short name of the context, often its course code. */
  readonly label?: string;
  /** The full name of the context. */
  readonly title?: string;
  /** The types of the context, as URIs of the context type vocabulary. */
  readonly type?: readonly string[];
}

/** The organization that supports the context (LTI 1.3 Core section 5.4.2). */
export interface OrganizationClaim {
  /** The identifier of the organization. */
  readonly id: string;
  /** The kind of organization, such as `institution`. */
  readonly type?: string;
  /** The name of the organization. */
  readonly name?: string;
  /** A short description of the organization. */
  readonly description?: string;
  /** The address of the organization's web presence. */
  readonly url?: string;
}

/** The instance of the platform that sends a message (LTI 1.3 Core section 5.4.3). */
export interface PlatformInstance {
  /** The identifier of the instance within the issuer. */
  readonly guid: string;
  /** The administrative contact of the instance. */
  readonly contactEmail?: string;
  /** A description of the instance. */
  readonly description?: string;
  /** The name of the instance. */
  readonly name?: string;
  /** The home address of the instance. */
  readonly url?: string;
  /** The vendor's code for the kind of platform. */
  readonly productFamilyCode?: string;
  /** The vendor's version of the platform. */
  readonly version?: string;
}

/** How the platform presents the tool (LTI 1.3 Core section 5.4.5). */
export interface LaunchPresentation {
  /** The window or frame the tool is shown in. */
  readonly documentTarget?: "frame" | "iframe" | "window";
  /** The height of the window or frame, in pixels. */
  readonly height?: number;
  /** The width of the window or frame, in pixels. */
  readonly width?: number;
  /** The address in the platform to which the tool sends the user back. */
  readonly returnUrl?: string;
  /** The locale of the presentation, as a language tag. */
  readonly locale?: string;
}

/** The fields of the LTI 1.1 migration claim (LTI Migration Guide, LTI 1.1 migration claim). */
export interface MigrationClaim {
  /** The `user_id` that LTI 1.1 sent, when it differs from the `sub`. */
  readonly userId?: string;
  /** The `context_id` that LTI 1.1 sent, when it differs from the context `id`. */
  readonly contextId?: string;
  /** The `tool_consumer_instance_guid` that LTI 1.1 sent, when it differs from the platform `guid`. */
  readonly toolConsumerInstanceGuid?: string;
  /** The `resource_link_id` that LTI 1.1 sent, when it differs from the resource link `id`. */
  readonly resourceLinkId?: string;
  /** The `oauth_consumer_key` of the LTI 1.1 integration. */
  readonly oauthConsumerKey: string;
  /** The base64 HMAC-SHA256 signature of the consumer key that proves the platform holds the LTI 1.1 secret. */
  readonly oauthConsumerKeySign?: string;
}

/** The LTI 1.1 migration claim of a message that a tool read, with the verdict on its signature. */
export interface VerifiedMigrationClaim extends MigrationClaim {
  /** Whether `oauth_consumer_key_sign` matched the host's LTI 1.1 secret; `readMessage` leaves it `false`, and `verifyMigration` decides. */
  readonly verified: boolean;
}

/** The endpoint claim of the Assignment and Grade Services (LTI AGS 2.0 section 3.1). */
export interface GradesClaim {
  /** The scopes the tool may ask an access token for. */
  readonly scopes: readonly string[];
  /** The address of the line item container of the context. */
  readonly lineitems?: string;
  /** The address of the one line item of the launched resource. */
  readonly lineitem?: string;
}

/** The claim of Names and Role Provisioning (NRPS 2.0 section 4.1). */
export interface RosterClaim {
  /** The address of the members of the context. */
  readonly contextMembershipsUrl: string;
  /** The versions of the service at that address. */
  readonly serviceVersions?: readonly string[];
}

/** The claim of Context Groups (Context Groups 1.0 section 2.5). */
export interface GroupsClaim {
  /** The address of the groups of the context. */
  readonly contextGroupsUrl: string;
  /** The address of the group sets of the context. */
  readonly contextGroupSetsUrl?: string;
  /** The scopes the tool may ask an access token for. */
  readonly scopes: readonly string[];
  /** The versions of the service at that address. */
  readonly serviceVersions: readonly string[];
}

/** The claim of the AfA PNP Connector (AfA PNP Connector 1.0, PNP service connector claims). */
export interface PreferencesClaim {
  /** The host of the service; the path of a record is appended to it. */
  readonly hostUrl: string;
  /** The identifiers of the activities that have a record. */
  readonly activityIds: readonly string[];
  /** The scopes the tool may ask an access token for. */
  readonly scopes: readonly string[];
}

/** The service claims that a message carries; a service the platform does not offer is absent. */
export interface MessageServices {
  /** The Assignment and Grade Services. */
  readonly grades?: GradesClaim;
  /** Names and Role Provisioning. */
  readonly roster?: RosterClaim;
  /** Context Groups. */
  readonly groups?: GroupsClaim;
  /** The AfA PNP Connector. */
  readonly preferences?: PreferencesClaim;
}

/** What every message that a platform sends carries. */
export interface MessageBase extends LtiDeployment {
  /** The version of LTI the message says, one of the versions the launch accepted. */
  readonly version: string;
  /** The endpoint the message is for. A tool relies on this claim and not on the unsigned parameter of the login. */
  readonly targetLinkUri: string;
  /** The user the message is about; the subject is absent in an anonymous launch. */
  readonly user: UserIdentity;
  /** The person acting, when an administrator impersonates the user. */
  readonly actualUser?: ActualUser;
  /** The roles of the user in the context, as the platform sent them. */
  readonly roles: readonly string[];
  /** The identifiers of the users a mentor may access. */
  readonly roleScopeMentor?: readonly string[];
  /** The context the message comes from. */
  readonly context?: ContextClaim;
  /** The organization that supports the context. */
  readonly organization?: OrganizationClaim;
  /** The instance of the platform. */
  readonly platform?: PlatformInstance;
  /** How the platform presents the tool. */
  readonly presentation?: LaunchPresentation;
  /** The identifiers of the Learning Information Services. */
  readonly lis?: Readonly<Record<string, string>>;
  /** The custom properties by name; a map so that a name such as `__proto__` stays data. */
  readonly custom: ReadonlyMap<string, string>;
  /** The service claims of the message. */
  readonly services: MessageServices;
  /** The LTI 1.1 migration claim; `verified` is true only when its signature matched the host's LTI 1.1 secret. */
  readonly migration?: VerifiedMigrationClaim;
  /** Every claim of the verified token as JSON, vendor claims among them (LTI 1.3 Core section 5.4.7). */
  readonly claims: Readonly<Record<string, JsonValue>>;
}

/** A launch of a resource link (`LtiResourceLinkRequest`, LTI 1.3 Core section 5). */
export interface ResourceLinkMessage extends MessageBase {
  /** The message type. */
  readonly messageType: "LtiResourceLinkRequest";
  /** The link that was launched. */
  readonly resourceLink: ResourceLink;
}

/** What the platform asks of the tool in a Deep Linking request (Deep Linking 2.0 section 4.4.1). */
export interface DeepLinkingSettings {
  /** Where the tool sends the response. */
  readonly returnUrl: string;
  /** The content item types the platform accepts, such as `ltiResourceLink`. */
  readonly acceptTypes: readonly string[];
  /** The ways the platform can present an item: `iframe`, `window` or `embed`. */
  readonly acceptPresentationDocumentTargets: readonly string[];
  /** The media types the platform accepts for a `file` item. */
  readonly acceptMediaTypes?: readonly string[];
  /** Whether the platform accepts several items in one response. */
  readonly acceptMultiple?: boolean;
  /** Whether the platform creates a line item for a resource link item that has one. */
  readonly acceptLineItem?: boolean;
  /** Whether the platform keeps the items without the user's confirmation. */
  readonly autoCreate?: boolean;
  /** The title to use for an item that has none. */
  readonly title?: string;
  /** The text to use for an item that has none. */
  readonly text?: string;
  /** An opaque value the response returns. */
  readonly data?: string;
}

/** A request to select content (`LtiDeepLinkingRequest`, Deep Linking 2.0 section 4.4). */
export interface DeepLinkingRequestMessage extends MessageBase {
  /** The message type. */
  readonly messageType: "LtiDeepLinkingRequest";
  /** What the platform asks of the tool. */
  readonly settings: DeepLinkingSettings;
}

/** The user whose work a review shows (Submission Review 1.0 section 2.7). */
export interface ForUser {
  /** The identifier of the graded user. */
  readonly userId: string;
  /** The Learning Information Services identifier of the graded user. */
  readonly personSourcedId?: string;
  /** The given names of the graded user. */
  readonly givenName?: string;
  /** The family names of the graded user. */
  readonly familyName?: string;
  /** The full name of the graded user. */
  readonly name?: string;
  /** The email address of the graded user. */
  readonly email?: string;
  /** The roles of the graded user in the context. */
  readonly roles?: readonly string[];
}

/** A launch from the gradebook to the work behind a result (`LtiSubmissionReviewRequest`, Submission Review 1.0). */
export interface SubmissionReviewMessage extends MessageBase {
  /** The message type. */
  readonly messageType: "LtiSubmissionReviewRequest";
  /** The resource link of the line item; absent for a standalone line item. */
  readonly resourceLink?: ResourceLink;
  /** The user whose work is shown. */
  readonly forUser: ForUser;
}

/** The Assessment Control Service that a proctoring tool may call (Proctoring Services 1.0 section 4.2.2.6). */
export interface AssessmentControlClaim {
  /** The address of the service. */
  readonly url: string;
  /** The actions the service supports. */
  readonly actions: readonly string[];
}

/** The tool-specific settings of a proctoring message (Proctoring Services 1.0 section 4.2.2.7). */
export interface ProctoringSettings {
  /** An opaque value that the proctoring tool interprets. */
  readonly data?: string;
}

/** The message that sends a candidate to a proctoring tool (`LtiStartProctoring`, Proctoring Services 1.0 section 4.2). */
export interface StartProctoringMessage extends MessageBase {
  /** The message type. */
  readonly messageType: "LtiStartProctoring";
  /** The assessment the candidate attempts. */
  readonly resourceLink: ResourceLink;
  /** The attempt of the candidate at the assessment, the first being 1. */
  readonly attemptNumber: number;
  /** Where the proctoring tool sends the candidate back to start the assessment. */
  readonly startAssessmentUrl: string;
  /** An opaque value the Start Assessment message returns. */
  readonly sessionData: string;
  /** The Assessment Control Service, when the platform offers one. */
  readonly assessmentControl?: AssessmentControlClaim;
  /** The proctoring settings. */
  readonly proctoringSettings?: ProctoringSettings;
}

/** The message that closes a proctored attempt (`LtiEndAssessment`, Proctoring Services 1.0 section 4.4). */
export interface EndAssessmentMessage extends MessageBase {
  /** The message type. */
  readonly messageType: "LtiEndAssessment";
  /** The attempt that ended. */
  readonly attemptNumber: number;
  /** The assessment that was attempted. */
  readonly resourceLink?: ResourceLink;
  /** The proctoring settings. */
  readonly proctoringSettings?: ProctoringSettings;
  /** A message for the user, when the assessment closed on an error. */
  readonly errorMessage?: string;
  /** A message for the log, when the assessment closed on an error. */
  readonly errorLog?: string;
}

/**
 * A message of a type that the packages do not model and that the host accepts through `otherMessageTypes`.
 *
 * @typeParam TType - The message types the host accepts. With none, no message is of this type, and a `switch` on
 * `messageType` narrows to the modeled messages.
 */
export interface OtherMessage<TType extends string = never> extends MessageBase {
  /** The message type, as sent. */
  readonly messageType: TType;
}

/**
 * A message that a platform sends and a tool reads.
 *
 * @typeParam TOther - The message types beyond the modeled ones that the host accepts; none by default.
 */
export type LtiMessage<TOther extends string = never> =
  | ResourceLinkMessage
  | DeepLinkingRequestMessage
  | SubmissionReviewMessage
  | StartProctoringMessage
  | EndAssessmentMessage
  | OtherMessage<TOther>;

/** What every message that a tool sends carries. */
export interface ToolMessageBase extends LtiDeployment {
  /** The version of LTI the message says. */
  readonly version: string;
  /** Every claim of the verified token as JSON, vendor claims among them. */
  readonly claims: Readonly<Record<string, JsonValue>>;
}

/** The response to a Deep Linking request (`LtiDeepLinkingResponse`, Deep Linking 2.0 section 4.5). */
export interface DeepLinkingResponseMessage extends ToolMessageBase {
  /** The message type. */
  readonly messageType: "LtiDeepLinkingResponse";
  /** The `data` of the request, returned. */
  readonly data?: string;
  /** The content items the user selected, possibly none. */
  readonly items: readonly JsonObject[];
  /** A message the platform may show to the user. */
  readonly message?: string;
  /** A message the platform may log. */
  readonly log?: string;
  /** A message about an error, which the platform may show to the user. */
  readonly errorMessage?: string;
  /** A message about an error, which the platform may log. */
  readonly errorLog?: string;
}

/** The message that sends a candidate back to start the assessment (`LtiStartAssessment`, Proctoring Services 1.0 section 4.3). */
export interface StartAssessmentMessage extends ToolMessageBase {
  /** The message type. */
  readonly messageType: "LtiStartAssessment";
  /** The `session_data` of the Start Proctoring message, returned. */
  readonly sessionData: string;
  /** The assessment, copied from the Start Proctoring message. */
  readonly resourceLink: ResourceLink;
  /** The attempt, copied from the Start Proctoring message. */
  readonly attemptNumber: number;
  /** Whether the platform shall send the End Assessment message when the attempt ends. */
  readonly endAssessmentReturn: boolean;
  /** The identity claims that the proctoring tool verified. */
  readonly verifiedUser?: Omit<UserIdentity, "subject">;
}

/** A message that a tool sends and a platform reads. */
export type ToolMessage = DeepLinkingResponseMessage | StartAssessmentMessage;
