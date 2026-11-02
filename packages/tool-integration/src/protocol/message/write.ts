// biome-ignore-all lint/style/useNamingConvention: The names of the claims are those of the LTI specifications.

import { DataError } from "@interopkit/core";
import { checkHttpsUrl, describe, type JsonValue } from "@interopkit/core/checks";
import {
  CLAIM,
  canonicalizeRole,
  isVocabularyContextType,
  isVocabularyRole,
  LTI_VERSION,
  MAX_IDENTIFIER_LENGTH,
  MENTOR_ROLE,
  PLATFORM_MESSAGE_TYPES,
} from "../claims/index.js";
import type {
  ActualUser,
  DeepLinkingRequestMessage,
  EndAssessmentMessage,
  ForUser,
  MessageBase,
  MessageServices,
  MigrationClaim,
  OtherMessage,
  ResourceLinkMessage,
  StartProctoringMessage,
  SubmissionReviewMessage,
  ToolMessage,
  UserIdentity,
} from "./model.js";

/** A JSON object whose members may be absent. */
interface Members {
  readonly [name: string]: JsonValue | undefined;
}

/** What the writer takes of a message beside the model: no claims read back, and the vendor claims of the sender. */
interface WriteExtras {
  /** The custom properties by name. */
  readonly custom?: ReadonlyMap<string, string>;
  /** The service claims of the message. */
  readonly services?: MessageServices;
  /** The LTI 1.1 migration claim, with its signature when the sender computed one. */
  readonly migration?: MigrationClaim;
  /** Claims of the sender's vendor by URL, which LTI lets a vendor add (LTI 1.3 Core section 5.4.7). */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** A message as the writer takes it: the model without the claims it would read back, and with `WriteExtras`. */
type Writable<TMessage extends MessageBase> = Omit<TMessage, "claims" | "migration" | "services" | "custom"> &
  WriteExtras;

/** The messages of the modeled types, as the writer takes them. */
type ModeledToWrite =
  | Writable<ResourceLinkMessage>
  | Writable<DeepLinkingRequestMessage>
  | Writable<SubmissionReviewMessage>
  | Writable<StartProctoringMessage>
  | Writable<EndAssessmentMessage>;

/** The model of a message that a platform sends, as the writer takes it: the claims are what the sender gives. */
export type MessageToWrite = ModeledToWrite | Writable<OtherMessage<string>>;

/** The model of a message that a tool sends, as the writer takes it. */
export type ToolMessageToWrite = ToolMessage extends infer TMessage
  ? TMessage extends unknown
    ? Omit<TMessage, "claims"> & {
        /** Claims of the sender's vendor by URL. */
        readonly extensions?: Readonly<Record<string, JsonValue>>;
      }
    : never
  : never;

/** Drops the members that are absent. */
function compact(members: Members): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(members).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}

/** Returns whether a claim name is a fully qualified URL. */
function isUrl(name: string): boolean {
  return URL.canParse(name) && /^https?:/u.test(name);
}

/** Checks a value that LTI limits to 255 characters (LTI 1.3 Core sections 5.3.3, 5.3.5 and 5.4). */
function checkIdentifier(value: string | undefined, label: string): void {
  if (value !== undefined && (value === "" || value.length > MAX_IDENTIFIER_LENGTH)) {
    throw new DataError(
      `${label} must be a string of 1 to ${MAX_IDENTIFIER_LENGTH} characters, found ${describe(value)}.`,
    );
  }
}

/** Checks that a role list is empty or holds a role of the vocabularies (LTI 1.3 Core section 5.3.7). */
function checkRoles(roles: readonly string[] | undefined, label: string): void {
  if (roles !== undefined && roles.length > 0 && !roles.some(isVocabularyRole)) {
    throw new DataError(
      `${label} must be empty or hold a role of the LTI role vocabularies (LTI 1.3 Core Appendix A), found ${describe(roles.join(", "))}.`,
    );
  }
}

/** Checks the rules that bind the sender of a message and that the receiver does not enforce. */
function checkSender(message: MessageToWrite): void {
  if (message.version !== LTI_VERSION) {
    throw new DataError(
      `The version of a message must be ${describe(LTI_VERSION)}, found ${describe(message.version)}.`,
    );
  }
  checkIdentifier(message.deploymentId, "The deployment of a message");
  checkIdentifier(message.user.subject, "The subject of a message");
  checkIdentifier(message.actualUser?.id, "The actual user of a message");
  checkIdentifier(message.context?.id, "The context of a message");
  checkIdentifier(message.organization?.id, "The organization of a message");
  checkIdentifier(message.platform?.guid, "The platform instance of a message");
  checkHttpsUrl(message.targetLinkUri, "The target link URI of a message");
  for (const name of Object.keys(message.extensions ?? {})) {
    if (!isUrl(name)) {
      throw new DataError(
        `The name of an extension claim must be a fully qualified URL (LTI 1.3 Core section 5.4.7), found ${describe(name)}.`,
      );
    }
  }
  checkRoles(message.roles, "The roles of a message");
  checkRoles(message.actualUser?.roles, "The roles of the actual user of a message");
  if (message.roleScopeMentor !== undefined && !message.roles.map(canonicalizeRole).includes(MENTOR_ROLE)) {
    throw new DataError(
      "A message may list users in roleScopeMentor only with the Mentor role (LTI 1.3 Core section 5.4.3).",
    );
  }
  const types = message.context?.type;
  if (types !== undefined && types.length > 0 && !types.some(isVocabularyContextType)) {
    throw new DataError(
      `The types of the context of a message must be empty or hold a type of the LTI context type vocabulary, found ${describe(types.join(", "))}.`,
    );
  }
}

/** Writes the identity claims of a user, which sit at the top of the message. */
function writeIdentity(user: Omit<UserIdentity, "subject">): Members {
  return {
    name: user.name,
    given_name: user.givenName,
    family_name: user.familyName,
    middle_name: user.middleName,
    email: user.email,
    email_verified: user.emailVerified,
    picture: user.picture,
    locale: user.locale,
  };
}

/** Writes the `actual_user` claim. */
function writeActualUser(user: ActualUser): Record<string, JsonValue> {
  return compact({ id: user.id, roles: user.roles, ...writeIdentity(user) });
}

/** Writes the `for_user` claim. */
function writeForUser(user: ForUser): Record<string, JsonValue> {
  return compact({
    user_id: user.userId,
    person_sourcedid: user.personSourcedId,
    given_name: user.givenName,
    family_name: user.familyName,
    name: user.name,
    email: user.email,
    roles: user.roles,
  });
}

/** Writes the service claims. */
function writeServices(services: MessageServices): Members {
  const { grades, roster, groups, preferences } = services;
  return {
    [CLAIM.agsEndpoint]:
      grades && compact({ scope: grades.scopes, lineitems: grades.lineitems, lineitem: grades.lineitem }),
    [CLAIM.namesRoleService]:
      roster &&
      compact({ context_memberships_url: roster.contextMembershipsUrl, service_versions: roster.serviceVersions }),
    [CLAIM.groupsService]:
      groups &&
      compact({
        context_groups_url: groups.contextGroupsUrl,
        context_group_sets_url: groups.contextGroupSetsUrl,
        scope: groups.scopes,
        service_versions: groups.serviceVersions,
      }),
    [CLAIM.preferencesService]:
      preferences &&
      compact({
        afapnp_endpoint_hosturl: preferences.hostUrl,
        afapnp_activity_ids: preferences.activityIds,
        scopes: preferences.scopes,
      }),
  };
}

/** Writes the claims that every message of a platform carries. */
function writeBase(message: MessageToWrite): Members {
  const { user, context, organization, platform, presentation, migration } = message;
  return {
    ...message.extensions,
    ...writeIdentity(user),
    sub: user.subject,
    [CLAIM.messageType]: message.messageType,
    [CLAIM.version]: message.version,
    [CLAIM.deploymentId]: message.deploymentId,
    [CLAIM.targetLinkUri]: message.targetLinkUri,
    [CLAIM.roles]: [...message.roles],
    [CLAIM.roleScopeMentor]: message.roleScopeMentor && [...message.roleScopeMentor],
    [CLAIM.actualUser]: message.actualUser && writeActualUser(message.actualUser),
    [CLAIM.context]:
      context &&
      compact({ id: context.id, label: context.label, title: context.title, type: context.type && [...context.type] }),
    [CLAIM.organization]: organization && compact({ ...organization }),
    [CLAIM.platformInstance]:
      platform &&
      compact({
        guid: platform.guid,
        contact_email: platform.contactEmail,
        description: platform.description,
        name: platform.name,
        url: platform.url,
        product_family_code: platform.productFamilyCode,
        version: platform.version,
      }),
    [CLAIM.launchPresentation]:
      presentation &&
      compact({
        document_target: presentation.documentTarget,
        height: presentation.height,
        width: presentation.width,
        return_url: presentation.returnUrl,
        locale: presentation.locale,
      }),
    [CLAIM.lis]: message.lis && { ...message.lis },
    [CLAIM.custom]: message.custom?.size ? Object.fromEntries(message.custom) : undefined,
    [CLAIM.migration]:
      migration &&
      compact({
        user_id: migration.userId,
        context_id: migration.contextId,
        tool_consumer_instance_guid: migration.toolConsumerInstanceGuid,
        resource_link_id: migration.resourceLinkId,
        oauth_consumer_key: migration.oauthConsumerKey,
        oauth_consumer_key_sign: migration.oauthConsumerKeySign,
      }),
    ...writeServices(message.services ?? {}),
  };
}

const MODELED_TYPES: readonly string[] = PLATFORM_MESSAGE_TYPES;

/** Returns whether a message is one of the modeled types, which have claims beyond the base. */
function isModeled(message: MessageToWrite): message is ModeledToWrite {
  return MODELED_TYPES.includes(message.messageType);
}

/** Writes the claims of a message by its type. */
function writeSpecific(message: MessageToWrite): Members {
  if (!isModeled(message)) return {};
  switch (message.messageType) {
    case "LtiResourceLinkRequest":
      return { [CLAIM.resourceLink]: compact({ ...message.resourceLink }) };
    case "LtiDeepLinkingRequest": {
      const { settings } = message;
      checkHttpsUrl(settings.returnUrl, "The return URL of the Deep Linking settings");
      return {
        [CLAIM.deepLinkingSettings]: compact({
          deep_link_return_url: settings.returnUrl,
          accept_types: [...settings.acceptTypes],
          accept_presentation_document_targets: [...settings.acceptPresentationDocumentTargets],
          accept_media_types: settings.acceptMediaTypes?.join(","),
          accept_multiple: settings.acceptMultiple,
          accept_lineitem: settings.acceptLineItem,
          auto_create: settings.autoCreate,
          title: settings.title,
          text: settings.text,
          data: settings.data,
        }),
      };
    }
    case "LtiSubmissionReviewRequest":
      if (message.services?.grades?.lineitem === undefined) {
        throw new DataError("A submission review request must carry the line item in services.grades.lineitem.");
      }
      return {
        [CLAIM.resourceLink]: message.resourceLink && compact({ ...message.resourceLink }),
        [CLAIM.forUser]: writeForUser(message.forUser),
      };
    case "LtiStartProctoring": {
      checkHttpsUrl(message.startAssessmentUrl, "The start assessment URL of the message");
      const control = message.assessmentControl;
      return {
        [CLAIM.resourceLink]: compact({ ...message.resourceLink }),
        [CLAIM.attemptNumber]: message.attemptNumber,
        [CLAIM.startAssessmentUrl]: message.startAssessmentUrl,
        [CLAIM.sessionData]: message.sessionData,
        [CLAIM.assessmentControl]: control && { assessment_control_url: control.url, actions: [...control.actions] },
        [CLAIM.proctoringSettings]: message.proctoringSettings && compact({ ...message.proctoringSettings }),
      };
    }
    case "LtiEndAssessment":
      return {
        [CLAIM.attemptNumber]: message.attemptNumber,
        [CLAIM.resourceLink]: message.resourceLink && compact({ ...message.resourceLink }),
        [CLAIM.proctoringSettings]: message.proctoringSettings && compact({ ...message.proctoringSettings }),
        [CLAIM.proctoringErrorMessage]: message.errorMessage,
        [CLAIM.proctoringErrorLog]: message.errorLog,
      };
  }
}

/**
 * Writes a message that a platform sends into its claims, as `readMessage` reads them. The claims leave out what the token
 * adds: `iss`, `aud`, `exp`, `iat`, `nonce` and `azp`.
 *
 * @remarks
 * The writer holds the sender to the rules that a receiver does not enforce: the version, the length of the identifiers, the
 * HTTPS addresses, a role and a context type of the vocabularies, and the Mentor role beside `roleScopeMentor`. It trusts
 * the types of the input: a host's input is checked where the host gives it.
 *
 * @param message - The message.
 * @returns The claims, as JSON.
 * @throws `DataError` when the message breaks a rule of the sender.
 */
export function writeMessage(message: MessageToWrite): Record<string, JsonValue> {
  checkSender(message);
  return compact({ ...writeBase(message), ...writeSpecific(message) });
}

/**
 * Writes a message that a tool sends into its claims, as `readToolMessage` reads them. The claims leave out what the token
 * adds: `iss`, `aud`, `exp`, `iat`, `nonce` and `azp`.
 *
 * @param message - The message.
 * @returns The claims, as JSON.
 * @throws `DataError` when the message breaks a rule of the sender.
 */
export function writeToolMessage(message: ToolMessageToWrite): Record<string, JsonValue> {
  if (message.version !== LTI_VERSION) {
    throw new DataError(
      `The version of a message must be ${describe(LTI_VERSION)}, found ${describe(message.version)}.`,
    );
  }
  checkIdentifier(message.deploymentId, "The deployment of a message");
  const common = {
    ...message.extensions,
    [CLAIM.messageType]: message.messageType,
    [CLAIM.version]: message.version,
    [CLAIM.deploymentId]: message.deploymentId,
  };
  if (message.messageType === "LtiDeepLinkingResponse") {
    return compact({
      ...common,
      [CLAIM.data]: message.data,
      [CLAIM.contentItems]: message.items.map((item) => ({ ...item })),
      [CLAIM.message]: message.message,
      [CLAIM.log]: message.log,
      [CLAIM.errorMessage]: message.errorMessage,
      [CLAIM.errorLog]: message.errorLog,
    });
  }
  return compact({
    ...common,
    [CLAIM.sessionData]: message.sessionData,
    [CLAIM.resourceLink]: compact({ ...message.resourceLink }),
    [CLAIM.attemptNumber]: message.attemptNumber,
    [CLAIM.endAssessmentReturn]: message.endAssessmentReturn ? true : undefined,
    [CLAIM.verifiedUser]: message.verifiedUser && compact(writeIdentity(message.verifiedUser)),
  });
}
