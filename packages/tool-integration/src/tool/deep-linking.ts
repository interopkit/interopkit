import { DataError, readClock, signCompactJws } from "@interopkit/core";
import {
  checkArray,
  checkHttpsUrl,
  checkNonEmptyString,
  checkProperties,
  checkRecord,
  checkString,
  describe,
  type JsonObject,
} from "@interopkit/core/checks";
import type { HttpResponse } from "@interopkit/core/http";
import type { ContentItem, DeepLinkingRequestMessage } from "../protocol/index.js";
import {
  callOptionsOf,
  findRefusal,
  LTI_VERSION,
  randomToken,
  readContentItem,
  renderPostPage,
  toSeconds,
  writeContentItem,
  writeToolMessage,
} from "../protocol/internal.js";
import { checkToolOptions, findDeployment, type ToolOptions } from "./options.js";

// Security Framework section 4.1.1: a message of the tool expires "typically five minutes after the iat timestamp".
const MESSAGE_TTL_SECONDS = 300;
const MESSAGE_TYPE = "LtiDeepLinkingRequest";
/** The form parameter that carries the signed response (Security Framework section 5.2.2). */
const RESPONSE_PARAMETER = "JWT";
const encoder = new TextEncoder();

/** What the tool answers a Deep Linking request with. */
export interface DeepLinkingResponseInput {
  /**
   * The content items that the user selected or the tool made; an empty list places none, and the tool sends the response
   * even then, so that the platform can close its frame (Deep Linking 2.0 section 2.3).
   */
  readonly items: readonly ContentItem[];
  /**
   * A message that the platform may show to the user.
   *
   * @defaultValue none
   */
  readonly message?: string;
  /**
   * A message that the platform may log.
   *
   * @defaultValue none
   */
  readonly log?: string;
  /**
   * A message about an error that the platform may show to the user.
   *
   * @defaultValue none
   */
  readonly errorMessage?: string;
  /**
   * A message about an error that the platform may log.
   *
   * @defaultValue none
   */
  readonly errorLog?: string;
}

const RESPONSE_PROPERTIES = ["items", "message", "log", "errorMessage", "errorLog"];

/** Checks the launch that the host passes: a Deep Linking request that `ltiLaunch` returned. */
function checkLaunch(value: unknown): asserts value is DeepLinkingRequestMessage {
  checkRecord(value, "The launch must be an object");
  if (value.messageType !== MESSAGE_TYPE) {
    throw new DataError(`The launch must be a ${MESSAGE_TYPE}, found the message type ${describe(value.messageType)}.`);
  }
  checkNonEmptyString(value.issuer, "The issuer of the launch");
  checkNonEmptyString(value.clientId, "The client identifier of the launch");
  checkNonEmptyString(value.deploymentId, "The deployment of the launch");
  const { settings } = value;
  checkRecord(settings, "The settings of the launch must be an object");
  checkHttpsUrl(settings.returnUrl, "The return URL of the launch");
  checkArray(settings.acceptTypes, "The accepted types of the launch must be an array");
  checkArray(
    settings.acceptPresentationDocumentTargets,
    "The accepted presentation document targets of the launch must be an array",
  );
  if (settings.acceptMediaTypes !== undefined) {
    checkArray(settings.acceptMediaTypes, "The accepted media types of the launch must be an array");
  }
  for (const name of ["acceptMultiple", "acceptLineItem"] as const) {
    if (settings[name] !== undefined && typeof settings[name] !== "boolean") {
      throw new DataError(`The ${name} of the launch must be a boolean, found ${describe(settings[name])}.`);
    }
  }
  if (settings.data !== undefined) checkString(settings.data, "The data of the launch");
}

/** Checks what the host answers with. */
function checkResponse(value: unknown): asserts value is DeepLinkingResponseInput {
  checkRecord(value, "The response must be an object");
  checkProperties(value, "A Deep Linking response", RESPONSE_PROPERTIES);
  checkArray(value.items, "The items must be an array");
  for (const name of ["message", "log", "errorMessage", "errorLog"] as const) {
    if (value[name] !== undefined) checkString(value[name], `The ${name} of a Deep Linking response`);
  }
}

/**
 * Writes an item that the host gave, and reads the claims back: the reader is the check of the item against its type, which
 * the host may pass from plain JavaScript.
 */
function writeItem(item: unknown, index: number): { readonly written: JsonObject; readonly read: ContentItem } {
  checkRecord(item, `The item ${index + 1} must be an object`);
  if (item.custom !== undefined && !(item.custom instanceof Map)) {
    throw new DataError(
      `The custom properties of the item ${index + 1} must be a Map of strings, found ${describe(item.custom)}.`,
    );
  }
  try {
    const written = writeContentItem(item as unknown as ContentItem);
    return { written, read: readContentItem(written) };
  } catch (error) {
    // The writer takes the types of the model, and a member of another kind, such as `null` for an image, fails it with a TypeError.
    if (error instanceof TypeError) {
      throw new DataError(`The item ${index + 1} is not a content item: ${error.message}.`);
    }
    throw error;
  }
}

/**
 * Answers a Deep Linking request: checks the items against what the request said the platform accepts, signs the response and
 * returns the page that posts it to the platform's `deep_link_return_url` (Deep Linking 2.0 sections 2.3 and 4.5).
 *
 * @remarks
 * The items are written as the specification has them and read back, so that an item breaks no rule of its type; then the
 * request's settings hold them: several items need `accept_multiple`, each type must be among `accept_types`, a file's media
 * type among `accept_media_types`, a line item is not sent where `accept_lineitem` is `false`, and an item that offers
 * presentations needs one that the platform supports in `accept_presentation_document_targets`. The response carries the
 * `data` of the request when it had one, a `nonce`, and the times that the Security Framework requires of a message of the tool
 * (section 5.2.2); the signer of the registration signs it, and its header names the signer's `keyId` as `kid`. The page posts the
 * form parameter `JWT` and nothing else, runs one script that its policy names by hash, and lets the form go only to the origin
 * of the return URL. The tool answers even when it places no item.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/launch_messages/deep_linking/lti-deep-linking-spec | LTI Deep Linking 2.0}
 * @param launch - The Deep Linking request that `ltiLaunch` returned.
 * @param response - The items to place, and the messages for the user and the log.
 * @param options - The registrations of the tool and its clock.
 * @returns The page to send to the browser.
 * @throws `DataError` when an argument has the wrong type, an item is not a content item, or the platform does not accept what
 * the items are.
 * @throws `LtiError` (`platform-unknown`, `deployment-unknown`) when the registration is gone or no longer lists the
 * deployment of the launch.
 * @throws The error of the signer when it fails, and the `reason` of `options.signal` when it aborts.
 */
export async function createDeepLinkResponse(
  launch: DeepLinkingRequestMessage,
  response: DeepLinkingResponseInput,
  options: ToolOptions,
): Promise<HttpResponse> {
  checkToolOptions(options);
  checkLaunch(launch);
  checkResponse(response);
  const items = response.items.map((item, index) => writeItem(item, index));
  const refusal = findRefusal(
    items.map(({ read }) => read),
    launch.settings,
  );
  if (refusal !== undefined) throw new DataError(refusal);
  const registration = await findDeployment(options, launch);
  const iat = toSeconds(readClock(options.clock));
  const claims = {
    ...writeToolMessage({
      messageType: "LtiDeepLinkingResponse",
      issuer: launch.issuer,
      clientId: launch.clientId,
      deploymentId: launch.deploymentId,
      version: LTI_VERSION,
      data: launch.settings.data,
      items: items.map(({ written }) => written),
      message: response.message,
      log: response.log,
      errorMessage: response.errorMessage,
      errorLog: response.errorLog,
    }),
    iss: registration.clientId,
    aud: registration.issuer,
    iat,
    exp: iat + MESSAGE_TTL_SECONDS,
    nonce: randomToken(),
  };
  const jwt = await signCompactJws(
    { typ: "JWT" },
    encoder.encode(JSON.stringify(claims)),
    registration.signer,
    callOptionsOf(options),
  );
  return renderPostPage({ action: launch.settings.returnUrl, fields: [[RESPONSE_PARAMETER, jwt]] });
}
