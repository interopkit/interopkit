import { type HttpResponse, jsonResponse } from "@interopkit/core/http";

/** The media type of a problem detail (RFC 9457). */
const PROBLEM_TYPE = "application/problem+json";

/** The most characters of a sentence that an answer quotes, so that an answer is never much larger than the request that caused it. */
const MAX_DETAIL_CHARS = 500;

/** Builds the answer of a failed request as a problem detail, which Caliper 1.2 section 6.1 allows beside the status. */
function problem(
  status: number,
  title: string,
  detail: string | undefined,
  headers: Readonly<Record<string, string>> = {},
): HttpResponse {
  const body = { type: "about:blank", title, status, ...(detail === undefined ? {} : { detail }) };
  return jsonResponse(status, body, headers, PROBLEM_TYPE);
}

/** Shortens a sentence to the most characters that an answer quotes. */
function limited(text: string): string {
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}...` : text;
}

/** The answer for a method that the endpoint does not serve: 405 with the methods that it serves. */
export const notAllowed = (method: string): HttpResponse =>
  problem(405, "Method Not Allowed", `The method ${limited(method)} is not allowed here; use GET or POST.`, {
    allow: "GET, POST",
  });

/** The answer for a request that is not authorized: 401 with the challenge of a bearer token (RFC 6750). */
export const unauthorized = (): HttpResponse =>
  problem(401, "Unauthorized", "The request was not authorized.", { "www-authenticate": "Bearer" });

/** The answer for a body that is not `application/json`: 415. */
export const unsupportedType = (): HttpResponse =>
  problem(415, "Unsupported Media Type", "The body must be application/json.");

/** The answer for a body above the limit: 413. */
export const tooLarge = (bytes: number, limit: number): HttpResponse =>
  problem(413, "Content Too Large", `The body has ${bytes} bytes, above the limit of ${limit} bytes.`);

/** The answer for a body that is not an envelope, or an envelope that strict reading refuses: 400, with the first fault. */
export const badRequest = (sentence: string): HttpResponse => problem(400, "Bad Request", limited(sentence));

/** The answer for an envelope of a version that the endpoint does not read: 422. */
export const unsupportedVersion = (found: string, supported: readonly string[]): HttpResponse =>
  problem(
    422,
    "Unprocessable Content",
    limited(
      `The dataVersion ${JSON.stringify(found)} is not one that this endpoint reads; it reads ${supported.join(" and ")}.`,
    ),
  );

/** The answer for a port that failed: 500, with nothing of the failure in it. */
export const internalError = (): HttpResponse => problem(500, "Internal Server Error", undefined);

/** The answer for an envelope that was received: 200 with an empty body, as Caliper 1.2 section 6.1 advises. */
export const received = (): HttpResponse => ({ status: 200, headers: {}, body: "" });
