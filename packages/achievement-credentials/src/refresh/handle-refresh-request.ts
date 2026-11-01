import { type CallOptions, DataError } from "@interopkit/core";
import { checkAbortSignal, checkFunction, checkRecord } from "@interopkit/core/checks";
import { checkHttpRequest, type HttpRequest, type HttpResponse, jsonResponse } from "@interopkit/core/http";

/** The options of `handleRefreshRequest`. */
export interface RefreshHandlerOptions extends CallOptions {
  /**
   * Returns the current version of the credential with an identifier: an object, or a compact JWS. `undefined` means that the
   * issuer has no such credential. A rejection is a 500 that says nothing of its cause.
   */
  readonly refresh: (
    id: string,
    options?: CallOptions,
  ) => Promise<string | Readonly<Record<string, unknown>> | undefined>;
}

/** Reads the identifier of the credential from a request: the last segment of the path, decoded. */
function idOf(request: HttpRequest): string | undefined {
  const segments = new URL(request.url).pathname.split("/").filter((segment) => segment !== "");
  const last = segments.at(-1);
  if (last === undefined) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return undefined;
  }
}

/**
 * Answers a request for the refresh of a credential, for the issuer that runs a refresh service (VCCR).
 *
 * @remarks
 * Only `GET` is answered (405 and `Allow: GET` otherwise). The identifier is the last segment of the path, decoded; a path with
 * none is a 400. The `refresh` port gives the current credential: 200 with the credential as JSON (`application/json`) or as a
 * compact JWS (`application/jwt`), 404 when the port knows no such credential, and 500 with no cause when the port rejects.
 * A rejection with the reason of the signal that aborted is passed on.
 *
 * @param request - The request.
 * @param options - The `refresh` port and a `signal`.
 * @returns The answer.
 * @throws `DataError` when the request or an option is not valid.
 * @throws The `reason` of the signal when it aborts.
 */
export async function handleRefreshRequest(
  request: HttpRequest,
  options: RefreshHandlerOptions,
): Promise<HttpResponse> {
  checkHttpRequest(request);
  checkRecord(options, "The options of handleRefreshRequest must be an object");
  checkFunction(options.refresh, "The option refresh must be a function");
  if (options.signal !== undefined) checkAbortSignal(options.signal, "The option signal");
  options.signal?.throwIfAborted();
  if (request.method !== "GET") return { status: 405, headers: { allow: "GET" }, body: "" };
  const id = idOf(request);
  if (id === undefined) return { status: 400, headers: {}, body: "" };
  let refreshed: string | Readonly<Record<string, unknown>> | undefined;
  try {
    refreshed = await options.refresh(id, options.signal === undefined ? undefined : { signal: options.signal });
  } catch {
    if (options.signal?.aborted) throw options.signal.reason;
    return { status: 500, headers: {}, body: "" };
  }
  if (refreshed === undefined) return { status: 404, headers: {}, body: "" };
  if (typeof refreshed === "string")
    return { status: 200, headers: { "content-type": "application/jwt" }, body: refreshed };
  if (typeof refreshed !== "object" || refreshed === null) {
    throw new DataError("The refresh port must answer a credential as an object, a compact JWS, or undefined.");
  }
  return jsonResponse(200, refreshed);
}
