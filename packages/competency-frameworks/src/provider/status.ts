import {
  type AccessRefusal,
  buildRefusalResponse,
  buildStatusInfoResponse,
  type HttpResponse,
  type RefusalCodes,
} from "@interopkit/core/http";
import type { StatusCodeMinorValue } from "../model/index.js";

/** The code of the binding for each reason that a host refuses a request. */
const REFUSAL_CODES: RefusalCodes<StatusCodeMinorValue> = {
  unauthenticated: "unauthorised_request",
  forbidden: "forbidden",
  "too-many-requests": "server_busy",
};

/**
 * Builds the answer of a failed request: the HTTP status and an `imsx_StatusInfo` with `failure` and `error`, as the REST
 * binding gives for every endpoint (2.4).
 *
 * @param status - The HTTP status code.
 * @param description - What went wrong, as a sentence.
 * @param minor - The detail code, or none when the binding has no code for the failure.
 * @param headers - More headers of the answer.
 */
export function failure(
  status: number,
  description: string,
  minor?: StatusCodeMinorValue,
  headers: Readonly<Record<string, string>> = {},
): HttpResponse {
  return buildStatusInfoResponse(status, description, { headers, ...(minor === undefined ? {} : { minor }) });
}

/** The answer for an object, or a path, that this provider does not have: 404 with the statement that the binding gives. */
export const unknownObject = (): HttpResponse => failure(404, "Unknown Object", "unknownobject");

/** The answer for an identifier that is not a UUID: 404 with the statement that the binding gives. */
export const invalidUuid = (): HttpResponse => failure(404, "Invalid UUID", "invalid_uuid");

/**
 * The answer for a request that the host's `authorize` refuses, with the host's message when it gives one: 401 for
 * `unauthenticated`, with its challenge or that of a bearer token; 403 for `forbidden`; or 429 for `too-many-requests`, with the
 * statement that the binding gives and `Retry-After` when known.
 */
export const refused = (refusal: AccessRefusal): HttpResponse => buildRefusalResponse(refusal, REFUSAL_CODES);

/** The answer for a port that failed: 500, with nothing of the failure in it. */
export const internalError = (): HttpResponse =>
  failure(500, "The provider could not answer the request.", "internal_server_error");

/** The answer for a method other than GET: 405 with the methods that the provider serves. */
export const methodNotAllowed = (method: string): HttpResponse =>
  failure(405, `The method ${method} is not allowed; use GET.`, undefined, { allow: "GET" });
