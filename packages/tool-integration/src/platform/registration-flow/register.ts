import { callPort, DataError, readClock } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { bearerTokenOf, type HttpRequest, type HttpResponse, jsonResponse } from "@interopkit/core/http";
import { errorBody, MILLISECONDS, toSeconds } from "../../protocol/internal.js";
import { methodNotAllowed, refusal, serverError } from "../answers.js";
import { openingKeys } from "../config.js";
import type { PlatformSettings } from "../options.js";
import type { RegistrationStore } from "../ports.js";
import { offeredScopes } from "../services/routes.js";
import { openRegistrationToken } from "../tokens.js";
import {
  admitConfiguration,
  readRegistrationBody,
  registrationAnswer,
  storedRefusal,
  storedRegistration,
} from "./tool-configuration.js";

const LABEL = "RegistrationStore.register";

/** The answer to a registration request whose token is missing, not this platform's, expired or used (RFC 6750 section 3.1). */
function invalidToken(description: string): HttpResponse {
  return jsonResponse(401, errorBody("invalid_token", description), {
    "www-authenticate": 'Bearer error="invalid_token"',
    "cache-control": "no-store",
  });
}

/**
 * Spends the registration token of a request, once: sealed by this platform, not expired, and not used before (Dynamic
 * Registration 1.0 section 3.3). Without a token the request passes only when `openRegistration` is set.
 *
 * @returns `undefined` when the request may register, or the answer: 401, or 500 when `once` fails.
 */
async function spendToken(request: HttpRequest, settings: PlatformSettings): Promise<HttpResponse | undefined> {
  const header = request.headers.authorization;
  if (header === undefined) {
    return settings.openRegistration
      ? undefined
      : invalidToken("The registration needs the registration token of its initiation.");
  }
  const sealed = bearerTokenOf(request);
  const token = sealed === undefined ? undefined : await openRegistrationToken(sealed, openingKeys(settings.config));
  if (token === undefined) return invalidToken("The registration token is not one that this platform issued.");
  if (toSeconds(readClock(settings.clock)) >= token.exp) return invalidToken("The registration token has expired.");
  const { signal } = settings;
  const recorded = await callPort(
    () => settings.once(`registration:${token.id}`, token.exp * MILLISECONDS, { signal }),
    signal,
  );
  if (recorded === undefined) return serverError();
  if (typeof recorded.value !== "boolean") {
    throw new DataError(`The option once must resolve with a boolean, found ${describe(recorded.value)}.`);
  }
  return recorded.value ? undefined : invalidToken("The registration token has been used.");
}

/**
 * Answers a registration request (Dynamic Registration 1.0 section 3.5): the route `/registration` of `handlePlatformRequest`.
 *
 * @remarks
 * The checks, in order: the method; the registration token, spent once, before the body is read (401 without one unless
 * `openRegistration`); the media type, the size and the configuration of section 2.2 (415, 413, 400 `invalid_client_metadata`);
 * the addresses of the tool (400); then the store, which receives the configuration with its scopes narrowed to those the
 * platform offers and grants it (201 with the recorded configuration, the client identifier and the client configuration
 * endpoint) or refuses it (400 `invalid_client_metadata`). A token is spent also when the configuration is refused, so the tool
 * starts again from the initiation.
 */
export async function answerRegistration(
  request: HttpRequest,
  store: RegistrationStore,
  settings: PlatformSettings,
): Promise<HttpResponse> {
  if (request.method !== "POST") return methodNotAllowed(request.method, "POST");
  const refused = await spendToken(request, settings);
  if (refused !== undefined) return refused;
  const body = readRegistrationBody(request, settings);
  if ("status" in body) return body;
  const admitted = admitConfiguration(body.value, settings, offeredScopes(settings));
  if ("status" in admitted) return admitted;
  const { signal } = settings;
  const asked = await callPort(() => store.register(admitted.value, { signal }), signal);
  if (asked === undefined) return serverError();
  const reason = storedRefusal(LABEL, asked.value);
  if (reason !== undefined) return refusal(400, "invalid_client_metadata", reason);
  return registrationAnswer(201, storedRegistration(LABEL, asked.value), settings);
}
