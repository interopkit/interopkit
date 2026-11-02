import { type AccessRefusal, type HttpResponse, statusInfoResponse } from "@interopkit/core/http";
import type { StatusCodeMinorValue } from "../model/index.js";

/**
 * Builds the answer of a failed request: the HTTP status and an `imsx_StatusInfo` with the code of OB B.3.6 that goes with it,
 * and the severity that the vocabulary pairs with the code.
 */
export function failure(
  status: number,
  description: string,
  minor: StatusCodeMinorValue,
  headers: Readonly<Record<string, string>> = {},
): HttpResponse {
  // OB B.3.6 pairs `not_found` with the severity `status`, and every other code of a failure with `error`.
  const severity = minor === "not_found" ? "status" : "error";
  return statusInfoResponse(status, description, { minor, severity, headers });
}

/** The answer for a path that is no endpoint of the API: 404. */
export const notFound = (): HttpResponse => failure(404, "The path is not an endpoint of the API.", "not_found");

/** The answer for a method that the endpoint does not serve: 405 with the methods that it serves. */
export const notAllowed = (method: string, allowed: readonly string[]): HttpResponse =>
  failure(405, `The method ${method} is not allowed here; use ${allowed.join(" or ")}.`, "not_allowed", {
    allow: allowed.join(", "),
  });

/**
 * The answer for a request that the host's `authorize` refuses, with the host's reason when it gives one: 401 with its challenge,
 * or that of a bearer token (RFC 6750); 403 with the challenge of RFC 6750 that names the scope the operation needs, since a
 * token that does not hold it is the refusal that this API knows; or 429 with `Retry-After` when the host gives the seconds.
 */
export function refused(refusal: AccessRefusal, scope: string): HttpResponse {
  const { status, reason, challenge, retryAfterSeconds } = refusal;
  if (status === 401) {
    return failure(401, reason ?? "The request was not authorized.", "unauthorizedrequest", {
      "www-authenticate": challenge ?? "Bearer",
    });
  }
  if (status === 403) {
    return failure(403, reason ?? "The request is not allowed.", "forbidden", {
      "www-authenticate": `Bearer error="insufficient_scope", scope="${scope}"`,
    });
  }
  return failure(
    429,
    reason ?? "The server is receiving too many requests: retry at a later time.",
    "server_busy",
    retryAfterSeconds === undefined ? {} : { "retry-after": String(retryAfterSeconds) },
  );
}

/** The answer for a port that failed: 500, with nothing of the failure in it. */
export const internalError = (): HttpResponse =>
  failure(500, "The server could not answer the request.", "internal_server_error");

/** The answer for a query parameter that cannot be used: 400. */
export const invalidQuery = (description: string): HttpResponse => failure(400, description, "invalid_query_parameter");

/** The answer for a body that cannot be read as what its media type says: 400. */
export const unreadable = (description: string): HttpResponse => failure(400, description, "unknown");

/** The answer for a body that reads, and is not a credential or a profile of the API: 422, as OB B.3.6 pairs `invalid_data`. */
export const invalidData = (description: string): HttpResponse => failure(422, description, "invalid_data");

/** The answer for a body above the limit: 413. */
export const tooLarge = (bytes: number, limit: number): HttpResponse =>
  failure(413, `The body has ${bytes} bytes, above the limit of ${limit} bytes.`, "unknown");

/** The answer for a body of a media type that the operation does not take: 415. */
export const unsupportedType = (found: string | undefined, accepted: readonly string[]): HttpResponse =>
  failure(
    415,
    `The body must be ${accepted.join(" or ")}, found ${found === undefined ? "no Content-Type" : JSON.stringify(found)}.`,
    "unknown",
  );
