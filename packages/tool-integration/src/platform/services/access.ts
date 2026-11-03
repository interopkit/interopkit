import { callPort, readClock } from "@interopkit/core";
import { type HttpRequest, type HttpResponse, jsonResponse } from "@interopkit/core/http";
import { errorBody, toSeconds } from "../../protocol/internal.js";
import { serverError } from "../answers.js";
import { openingKeys } from "../config.js";
import type { PlatformSettings } from "../options.js";
import type { ServiceCaller } from "../ports.js";
import { readToolRegistration } from "../registration.js";
import { openAccess } from "../tokens.js";

/** The credentials of `Authorization: Bearer` (RFC 6750 section 2.1): the scheme in any case, one or more spaces, the token. */
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/iu;

/** Returns the token of an `Authorization` header of the bearer scheme, or `undefined` when the header is not one. */
export function bearerToken(header: string): string | undefined {
  return BEARER.exec(header)?.[1];
}

/** Builds the answer of a service to a request whose token is missing, unusable or too narrow (RFC 6750 section 3). */
function refusal(status: 401 | 403, challenge: string, error: string, description: string): HttpResponse {
  return jsonResponse(status, errorBody(error, description), { "www-authenticate": challenge });
}

/** The answer to a request whose token is missing, expired, not this platform's, or of a tool it no longer has. */
const invalidToken = (description: string): HttpResponse =>
  refusal(401, 'Bearer error="invalid_token"', "invalid_token", description);

/**
 * Reads the access token of a request to a service and checks it against the registration as it is now: the `Authorization`
 * header holds a bearer token that this platform sealed, it has not expired, the tool still has a registration and the
 * deployment of the token, and the token holds, among the scopes that the registration still grants, one of the scopes that
 * the request needs. A removed tool so loses access at once, and a narrowed one at its next request.
 *
 * @param needed - The scopes that allow the request; one is enough.
 * @returns The caller, or the answer to send: 401 with `WWW-Authenticate: Bearer`, 403 `insufficient_scope`, or 500 when the
 * lookup of the tool fails.
 */
export async function authorizeService(
  request: HttpRequest,
  settings: PlatformSettings,
  needed: readonly string[],
): Promise<ServiceCaller | HttpResponse> {
  const header = request.headers.authorization;
  if (header === undefined) {
    return refusal(401, "Bearer", "invalid_token", "The request needs an access token of the platform.");
  }
  const token = bearerToken(header);
  const access = token === undefined ? undefined : await openAccess(token, openingKeys(settings.config));
  if (access === undefined) return invalidToken("The access token is not one that this platform issued.");
  if (toSeconds(readClock(settings.clock)) >= access.exp) return invalidToken("The access token has expired.");
  const { signal } = settings;
  const asked = await callPort(() => settings.client(access.client, { signal }), signal);
  if (asked === undefined) return serverError();
  const registration = readToolRegistration(asked.value, access.client);
  const { deployment } = access;
  if (registration === undefined || (deployment !== undefined && !registration.deploymentIds.includes(deployment))) {
    return invalidToken("The tool of the access token, or its deployment, is no longer registered.");
  }
  const scopes = access.scopes.filter((scope) => registration.scopes.includes(scope));
  if (!scopes.some((scope) => needed.includes(scope))) {
    return refusal(
      403,
      `Bearer error="insufficient_scope", scope="${needed.join(" ")}"`,
      "insufficient_scope",
      `The request needs one of the scopes ${needed.join(", ")}.`,
    );
  }
  return { clientId: registration.clientId, ...(deployment === undefined ? {} : { deploymentId: deployment }) };
}
