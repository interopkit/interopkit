import { checkNonNegativeInteger, checkRecord } from "@interopkit/core/checks";
import { checkHttpRequest, type HttpRequest, type HttpResponse, jsonResponse } from "@interopkit/core/http";
import type { KeySet } from "../protocol/index.js";
import { checkKeySet } from "../protocol/internal.js";

// Security Framework section 6.3 lets the issuer say how long a retriever may cache the key set. An hour matches the cache of
// the key sets that the package reads, so a rotation that waits one max-age is followed by both.
const DEFAULT_MAX_AGE_SECONDS = 3600;

/** The options of `serveToolJwks`. */
export interface ServeToolJwksOptions {
  /**
   * How long a platform may cache the key set, in seconds: the `max-age` of `Cache-Control`. A rotation adds the new public
   * key at least this long before the signer uses it.
   *
   * @defaultValue `3600`
   */
  readonly maxAgeSeconds?: number;
}

/**
 * Answers a request for the tool's key set (Security Framework section 6.3, RFC 7517 section 5): the public keys of the key
 * set, the current one and any kept for a rotation, which verify the tool's client assertions and Deep Linking responses.
 *
 * @remarks
 * A GET answers the set as JSON with `Cache-Control: public, max-age`, a HEAD the same headers with no body, and any other
 * method 405 with `Allow: GET, HEAD`. The key set is checked on every call, so a key with a private member, a duplicate `kid`
 * or a signer whose key is not published never reaches a platform.
 *
 * @param request - The request to the tool's key set URL.
 * @param keys - The tool's key set.
 * @param options - How long a platform may cache the set.
 * @returns The answer, which the host sends.
 * @throws `DataError` when the request, the key set or the options are not valid.
 */
export function serveToolJwks(request: HttpRequest, keys: KeySet, options: ServeToolJwksOptions = {}): HttpResponse {
  checkHttpRequest(request);
  checkKeySet(keys);
  checkRecord(options, "The options must be an object");
  const { maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS } = options;
  checkNonNegativeInteger(maxAgeSeconds, "The option maxAgeSeconds");
  if (request.method !== "GET" && request.method !== "HEAD") {
    return { status: 405, headers: { allow: "GET, HEAD" }, body: "" };
  }
  const response = jsonResponse(
    200,
    { keys: keys.publicKeys },
    { "cache-control": `public, max-age=${maxAgeSeconds}` },
  );
  return request.method === "HEAD" ? { ...response, body: "" } : response;
}
