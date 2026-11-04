import { DataError, LimitError, readClock } from "@interopkit/core";
import { describe, type JsonObject } from "@interopkit/core/checks";
import { checkHttpRequest, type HttpRequest } from "@interopkit/core/http";
import { LtiError } from "../../errors.js";
import type { ContentItem, DeepLinkingResponseMessage, DeepLinkingSettings } from "../../protocol/index.js";
import { CLAIM, findRefusal, readContentItem, readToolMessage, toSeconds } from "../../protocol/internal.js";
import { openingKeys } from "../config.js";
import { readToolMessageOptions, type ToolMessageOptions } from "../options.js";
import { openDeepLinkingData } from "../tokens.js";
import { readToolToken, spendNonce } from "../tool-message.js";

/**
 * The most bytes of the form of a Deep Linking response by default: a token that lists up to 100 items, each with a few
 * kilobytes of text and addresses.
 */
const DEFAULT_MAX_FORM_BYTES = 1_048_576;
const MESSAGE_TYPE = "LtiDeepLinkingResponse";

/** A Deep Linking response that a tool posted and the platform verified. */
export interface ReceivedDeepLinkingResponse extends Omit<DeepLinkingResponseMessage, "data" | "items"> {
  /**
   * The host's own data of the request, which the platform sealed into it; absent when the request had none.
   *
   * @defaultValue none
   */
  readonly data?: JsonObject;
  /** The settings of the request that the response answers, as the platform sent them, but for the host's data. */
  readonly settings: Omit<DeepLinkingSettings, "data">;
  /**
   * The `sub` of the Deep Linking request that the response answers, from its sealed data. The host places the items only when
   * its own session of the browser is of this user, so that a response that another user's browser posts places nothing.
   *
   * @defaultValue none, for an anonymous launch
   */
  readonly subject?: string;
  /** The content items that the tool placed, each read by its type, and within what the request accepted. */
  readonly items: readonly ContentItem[];
}

/** Reads the items of a response, each as its type has it. */
function readItems(items: readonly JsonObject[]): ContentItem[] {
  return items.map((item, index) => {
    try {
      return readContentItem(item);
    } catch (error) {
      if (error instanceof DataError) {
        throw new LtiError(`The item ${index + 1} is not a content item: ${error.message}`, "content-item-refused", {
          cause: error,
        });
      }
      throw error;
    }
  });
}

/**
 * Reads the form that a tool posts to the `deep_link_return_url` of a Deep Linking request, and checks it (Deep Linking 2.0
 * section 4.5, Security Framework section 5.2.3).
 *
 * @remarks
 * The checks, in order: the method and the size of the form; the tool that `iss` names, its algorithm, key and signature; `aud` as
 * the platform's issuer; `exp`, `iat` and `nonce`, the expiry within an hour; the number of items; the `message_type`, the version
 * and the deployment of the tool; the single use of the `nonce`; the `data` claim, which the platform sealed in the request with its
 * settings and the host's own data, for this tool, this deployment and a time not past; each item as its type has it; and the items against the settings of the request (`accept_types`, `accept_multiple`, `accept_media_types`,
 * `accept_lineitem` and `accept_presentation_document_targets`). Nothing is looked up beside the tool, so the response may come
 * to any process, and its settings are those the platform sent. The sealed data is the anti-CSRF token of the request, and the
 * host completes it: it places the items only when its own session of the browser is of `subject`. Whether the user confirms
 * the items, and what to do with `autoCreate`, are the host's.
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/launch_messages/deep_linking/lti-deep-linking-spec | LTI Deep Linking 2.0}
 * @param request - The request to the host's route at `deep_link_return_url`.
 * @param options - The platform, its tools, the single-use ledger and the limits.
 * @returns The response, with the host's data, the items and the subject of the request.
 * @throws `LtiError` with the reason of the failed check: those of the message of a tool (`request-invalid`, `form-too-large`,
 * `client-unknown`, `signature-invalid`, `nonce-replayed` and the others of `verifyJwt`), `deployment-unknown`,
 * `version-unsupported`, `deep-linking-data-invalid`, `content-items-limit` and `content-item-refused`.
 * @throws `DataError` when the request or an option has the wrong type, or a port breaks its contract.
 * @throws The error of `options.client` and `options.once`, a `ServiceError` when the key set of the tool cannot be fetched, and
 * the `reason` of `options.signal` when it aborts.
 */
export async function readDeepLinkingResponse(
  request: HttpRequest,
  options: ToolMessageOptions,
): Promise<ReceivedDeepLinkingResponse> {
  checkHttpRequest(request);
  const settings = readToolMessageOptions(options, DEFAULT_MAX_FORM_BYTES);
  const { config } = settings;
  const token = await readToolToken(request, settings);
  const { registration, claims } = token;
  const listed = claims[CLAIM.contentItems];
  if (Array.isArray(listed) && listed.length > settings.maxContentItems) {
    throw new LimitError(
      `The response lists ${listed.length} items, above the limit of ${settings.maxContentItems} of the option maxContentItems.`,
      "maxContentItems",
      settings.maxContentItems,
    );
  }
  const message = readToolMessage(claims, {
    issuer: config.issuer,
    clientId: registration.clientId,
    deploymentIds: registration.deploymentIds,
  });
  if (message.messageType !== MESSAGE_TYPE) {
    throw new LtiError(`The message type must be ${MESSAGE_TYPE}.`, "message-type-unsupported");
  }
  await spendNonce(settings, token);
  const sealed = await openDeepLinkingData(message.data ?? "", openingKeys(config));
  if (sealed === undefined) {
    throw new LtiError(
      "The data claim is not the data of a Deep Linking request that this platform sent.",
      "deep-linking-data-invalid",
    );
  }
  if (sealed.client !== registration.clientId || sealed.deployment !== message.deploymentId) {
    throw new LtiError(
      `The data of the request was sealed for the tool ${describe(sealed.client)} and its deployment ${describe(sealed.deployment)}.`,
      "deep-linking-data-invalid",
    );
  }
  if (toSeconds(readClock(settings.clock)) >= sealed.exp) {
    throw new LtiError("The data of the request has expired.", "deep-linking-data-invalid");
  }
  const items = readItems(message.items);
  const refusal = findRefusal(items, sealed.settings);
  if (refusal !== undefined) throw new LtiError(refusal, "content-item-refused");
  const { data: _sealedData, items: _jsonItems, ...rest } = message;
  return {
    ...rest,
    settings: sealed.settings,
    items,
    ...(sealed.data === undefined ? {} : { data: sealed.data }),
    ...(sealed.subject === undefined ? {} : { subject: sealed.subject }),
  };
}
