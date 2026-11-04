import { readClock } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { checkHttpRequest, type HttpRequest } from "@interopkit/core/http";
import { LtiError } from "../../errors.js";
import type { StartAssessmentMessage } from "../../protocol/index.js";
import { readToolMessage, toSeconds } from "../../protocol/internal.js";
import { openingKeys } from "../config.js";
import { readToolMessageOptions, type ToolMessageOptions } from "../options.js";
import { openSessionData } from "../tokens.js";
import { readToolToken, spendNonce } from "../tool-message.js";

/** The most bytes of the form of a Start Assessment message by default: one token with a few claims of identity. */
const DEFAULT_MAX_FORM_BYTES = 65_536;
const MESSAGE_TYPE = "LtiStartAssessment";

/** A Start Assessment message that a proctoring tool posted and the platform verified. */
export interface ReceivedStartAssessment extends StartAssessmentMessage {
  /**
   * The `sub` of the Start Proctoring message whose session data the message returns, from the sealed session data. The host
   * starts the attempt only when its own session of the browser is of this user.
   *
   * @defaultValue none, for an anonymous launch
   */
  readonly subject?: string;
}

/**
 * Reads the form that a proctoring tool posts to the `start_assessment_url` of a Start Proctoring message, and checks it
 * (Proctoring Services 1.0 section 4.3, Security Framework section 5.2.3).
 *
 * @remarks
 * The checks, in order: the method and the size of the form; the tool that `iss` names, its algorithm, key and signature; `aud` as
 * the platform's issuer; `exp`, `iat` and `nonce`, the expiry within an hour; the `message_type`, the version and the deployment of
 * the tool; the single use of the `nonce`; and the `session_data`, which the platform sealed into the Start Proctoring message: for
 * this tool and this deployment, for the resource link and the attempt that the message copies, at a time not past. The sealed
 * session data is the anti-CSRF token of the specification, and the host completes it: it starts the attempt only when its own
 * session of the browser is of `subject`. The `verifiedUser` claims are what the tool says it verified; which of them the host
 * requires is its own agreement with the tool.
 *
 * @see {@link https://www.imsglobal.org/spec/proctoring/v1p0 | Proctoring Services 1.0}
 * @param request - The request to the host's route at `start_assessment_url`.
 * @param options - The platform, its tools, the single-use ledger and the limits; `maxFormBytes` is 65,536 by default.
 * @returns The message, with the subject of the session data.
 * @throws `LtiError` with the reason of the failed check: those of the message of a tool (`request-invalid`, `form-too-large`,
 * `client-unknown`, `signature-invalid`, `nonce-replayed` and the others of `verifyJwt`), `message-type-unsupported`,
 * `deployment-unknown`, `version-unsupported`, `claim-missing`, `claim-invalid` and `session-data-invalid`.
 * @throws `DataError` when the request or an option has the wrong type, or a port breaks its contract.
 * @throws The error of `options.registration` and `options.once`, a `ServiceError` when the key set of the tool cannot be fetched, and
 * the `reason` of `options.signal` when it aborts.
 */
export async function readStartAssessment(
  request: HttpRequest,
  options: ToolMessageOptions,
): Promise<ReceivedStartAssessment> {
  checkHttpRequest(request);
  const settings = readToolMessageOptions(options, DEFAULT_MAX_FORM_BYTES);
  const { config } = settings;
  const token = await readToolToken(request, settings);
  const { registration, claims } = token;
  const message = readToolMessage(claims, {
    issuer: config.issuer,
    clientId: registration.clientId,
    deploymentIds: registration.deploymentIds,
  });
  if (message.messageType !== MESSAGE_TYPE) {
    throw new LtiError(`The message type must be ${MESSAGE_TYPE}.`, "message-type-unsupported");
  }
  await spendNonce(settings, token);
  const sealed = await openSessionData(message.sessionData, openingKeys(config));
  if (sealed === undefined) {
    throw new LtiError(
      "The session data is not the session data of a Start Proctoring message that this platform sent.",
      "session-data-invalid",
    );
  }
  if (sealed.client !== registration.clientId || sealed.deployment !== message.deploymentId) {
    throw new LtiError(
      `The session data was sealed for the tool ${describe(sealed.client)} and its deployment ${describe(sealed.deployment)}.`,
      "session-data-invalid",
    );
  }
  if (sealed.resourceLink !== message.resourceLink.id || sealed.attempt !== message.attemptNumber) {
    throw new LtiError(
      `The session data was sealed for the attempt ${sealed.attempt} at the resource link ${describe(sealed.resourceLink)}, which the message must copy unchanged.`,
      "session-data-invalid",
    );
  }
  if (toSeconds(readClock(settings.clock)) >= sealed.exp) {
    throw new LtiError("The session data has expired.", "session-data-invalid");
  }
  return sealed.subject === undefined ? message : { ...message, subject: sealed.subject };
}
