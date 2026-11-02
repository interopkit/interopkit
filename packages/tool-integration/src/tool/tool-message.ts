import { readClock, signCompactJws } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import {
  callOptionsOf,
  randomToken,
  renderPostPage,
  type ToolMessageToWrite,
  toSeconds,
  writeToolMessage,
} from "../protocol/internal.js";
import type { ToolOptions } from "./options.js";
import type { PlatformRegistration } from "./registration.js";

// Security Framework section 4.1.1: a message of the tool expires "typically five minutes after the iat timestamp".
const MESSAGE_TTL_SECONDS = 300;
/** The form parameter that carries the signed message (Security Framework section 5.2.2). */
const MESSAGE_PARAMETER = "JWT";
const encoder = new TextEncoder();

/**
 * Signs a message of the tool and returns the page that posts it to an address of the platform (Security Framework section
 * 5.2.2): the claims of the message with `iss` the client identifier, `aud` the platform's issuer, `iat`, `exp` five minutes later
 * and a fresh `nonce`, signed by the signer of the registration with its `keyId` as `kid`. The page posts the form parameter `JWT`
 * and nothing else, runs one script that its policy names by hash, and lets the form go only to the origin of the address.
 *
 * @param message - The message, which the writer of tool messages checks.
 * @param registration - The registration of the platform, whose signer signs.
 * @param action - The address of the platform that receives the message, from a signed message of the platform.
 * @param options - The clock and the signal.
 * @throws `DataError` when the message breaks a rule of the sender.
 * @throws The error of the signer when it fails, and the `reason` of `options.signal` when it aborts.
 */
export async function postToolMessage(
  message: ToolMessageToWrite,
  registration: PlatformRegistration,
  action: string,
  options: ToolOptions,
): Promise<HttpResponse> {
  const iat = toSeconds(readClock(options.clock));
  const claims = {
    ...writeToolMessage(message),
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
  return renderPostPage({ action, fields: [[MESSAGE_PARAMETER, jwt]] });
}
