import { type AccessRefusal, buildStatusInfoResponse, type HttpResponse } from "@interopkit/core/http";
import type { StatusCodeMinorValue } from "../model/index.js";

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
export function refused(refusal: AccessRefusal): HttpResponse {
  const { reason, message, challenge, retryAfterSeconds } = refusal;
  if (reason === "unauthenticated") {
    return failure(401, message ?? "The request was not authorized.", "unauthorised_request", {
      "www-authenticate": challenge ?? "Bearer",
    });
  }
  if (reason === "forbidden") return failure(403, message ?? "The request is not allowed.", "forbidden");
  return failure(
    429,
    message ?? "The provider is busy: retry at a later time.",
    "server_busy",
    retryAfterSeconds === undefined ? {} : { "retry-after": String(retryAfterSeconds) },
  );
}

/** The answer for a port that failed: 500, with nothing of the failure in it. */
export const internalError = (): HttpResponse =>
  failure(500, "The provider could not answer the request.", "internal_server_error");

/** The answer for a method other than GET: 405 with the methods that the provider serves. */
export const methodNotAllowed = (method: string): HttpResponse =>
  failure(405, `The method ${method} is not allowed; use GET.`, undefined, { allow: "GET" });
