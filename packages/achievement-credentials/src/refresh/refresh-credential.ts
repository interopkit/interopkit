import { type CallOptions, callService, DataError, type Fetch } from "@interopkit/core";
import { checkRecord, isRecord, MAX_JSON_DEPTH, parseJsonText } from "@interopkit/core/checks";
import { isCompactJws } from "../compact-jws.js";
import { jsonRefusals } from "../json-text.js";
import type { CredentialV1p1, IssuableCredential } from "../model/index.js";
import { type FetchSettings, fetchOf, readFetchSettings } from "../option-checks.js";

/** The types of a refresh service: `1EdTechCredentialRefresh` of Open Badges 9.1, and `ImsCredentialRefresh` that CLR 8.1 writes. */
const REFRESH_TYPES: readonly string[] = ["1EdTechCredentialRefresh", "ImsCredentialRefresh"];

/** The options of `refreshCredential`. */
export interface RefreshOptions extends CallOptions {
  /** The `fetch` that gets the refreshed credential. */
  readonly fetch: Fetch;
  /**
   * The time that the fetch may take, in milliseconds.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
  /**
   * The most bytes of the refreshed credential.
   *
   * @defaultValue `1048576`
   */
  readonly maxBytes?: number;
  /**
   * The most tokens of JSON in the refreshed credential: the memory of a parse grows with the tokens and not with the bytes.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
}

/**
 * Gets the newer version of a credential from its refresh service.
 *
 * @remarks
 * A credential with a `refreshService` of type `1EdTechCredentialRefresh` (or `ImsCredentialRefresh`, as CLR 8.1 writes it) is
 * refreshed by a `GET` of the address of the service, over HTTPS, without redirects, within the time and size limits. The answer
 * is a credential as JSON or a compact JWS. Nothing about the answer is trusted: it is a candidate that the caller verifies like
 * any credential, and it is refreshed once, not again if it names a refresh service itself (Open Badges 9.1).
 *
 * @param credential - The credential to refresh.
 * @param options - The `fetch` and the limits.
 * @returns The refreshed credential as the service gave it, or `undefined` when the credential has no refresh service of a type
 * that this function knows.
 * @throws `DataError` when an argument is not valid, or the answer is not JSON that nests within 64 levels or a compact JWS.
 * @throws `ServiceError` when the service did not answer, answered a status other than 200, or sent too much.
 * @throws The `reason` of the signal when it aborts.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/#refreshing | Open Badges 3.0, 9.1}
 */
export async function refreshCredential(
  credential: IssuableCredential | CredentialV1p1,
  options: RefreshOptions,
): Promise<string | Readonly<Record<string, unknown>> | undefined> {
  checkRecord(credential, "The credential must be an object");
  checkRecord(options, "The options of refreshCredential must be an object");
  const settings = readFetchSettings(options);
  if (settings.fetch === undefined) throw new DataError("The option fetch must be a function, found undefined.");
  return await refreshCredentialWith(credential, settings);
}

/**
 * Gets the newer version of a credential from its refresh service as `refreshCredential` does, with the settings that its
 * caller has checked.
 *
 * @throws `DataError` when the answer is not JSON within the limits or a compact JWS.
 * @throws `ServiceError` when the service did not answer, answered a status other than 200, or sent too much.
 * @throws The `reason` of the signal when it aborts.
 */
export async function refreshCredentialWith(
  credential: IssuableCredential | CredentialV1p1,
  settings: FetchSettings,
): Promise<string | Readonly<Record<string, unknown>> | undefined> {
  const { timeoutMs, maxBytes, maxTokens, signal } = settings;
  signal?.throwIfAborted();
  const service: unknown = credential.refreshService;
  if (!isRecord(service) || typeof service.type !== "string" || !REFRESH_TYPES.includes(service.type)) return undefined;
  if (typeof service.id !== "string" || !service.id.startsWith("https://") || !URL.canParse(service.id)) {
    throw new DataError("The id of the refreshService must be an absolute HTTPS address.");
  }
  const text = await callService(
    { fetch: fetchOf(settings), timeoutMs, ...(signal === undefined ? {} : { signal }) },
    `The refresh service at ${service.id}`,
    service.id,
    { method: "GET", headers: { accept: "application/json, application/jwt, application/vc+jwt" } },
    { maxBytes },
  );
  const body = text.trim();
  if (!body.startsWith("{")) {
    if (!isCompactJws(body)) {
      throw new DataError(
        "The refresh service answered something that is neither a credential as JSON nor a compact JWS.",
      );
    }
    return body;
  }
  const limits = { maxDepth: MAX_JSON_DEPTH, maxTokens };
  // A text that starts with a brace and parses is an object.
  return parseJsonText(body, limits, jsonRefusals("The refreshed credential", limits)) as Readonly<
    Record<string, unknown>
  >;
}
