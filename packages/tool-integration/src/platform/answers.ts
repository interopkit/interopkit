import { DataError } from "@interopkit/core";
import { buildJsonResponse, type HttpResponse } from "@interopkit/core/http";
import { errorBody } from "../protocol/internal.js";

/** The headers of an answer that holds a token or an error about one: never cached (RFC 6749 section 5.1). */
export const NO_STORE: Readonly<Record<string, string>> = { "cache-control": "no-store", pragma: "no-cache" };

/** Builds an answer with an error code and its description, as OAuth 2.0 and the services write them. */
export function refusal(status: number, error: string, description: string): HttpResponse {
  return buildJsonResponse(status, errorBody(error, description), { headers: NO_STORE });
}

/**
 * Narrows what a reader of a request threw to its `DataError`, which says what is wrong with the request. Any other failure is not
 * the request's fault, so it passes: a refusal never hides a failure of the code or of the host.
 */
export function refusedBy(error: unknown): DataError {
  if (error instanceof DataError) return error;
  throw error;
}

/** Builds the answer to a request whose body, or what it holds, is larger than a limit. */
export function tooLarge(description: string): HttpResponse {
  return refusal(413, "request_too_large", description);
}

/** Builds the answer to a method that a route does not serve, with the methods it does in `Allow`. */
export function methodNotAllowed(method: string, allow: string): HttpResponse {
  return buildJsonResponse(
    405,
    errorBody("method_not_allowed", `The method ${method} is not allowed here: use ${allow}.`),
    {
      headers: {
        allow,
      },
    },
  );
}

/** Builds the answer to a path that names nothing of the platform. */
export function notFound(): HttpResponse {
  return buildJsonResponse(404, errorBody("not_found", "The platform has no such resource."));
}

/** Builds the answer when a port of the host failed: 500, with nothing of the cause. */
export function serverError(): HttpResponse {
  return buildJsonResponse(500, errorBody("server_error", "The platform could not answer the request."), {
    headers: NO_STORE,
  });
}
