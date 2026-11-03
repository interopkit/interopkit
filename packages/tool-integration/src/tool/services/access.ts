import {
  type CallOptions,
  DataError,
  findLinkTarget,
  requestService,
  ServiceError,
  type ServiceInit,
  type ServiceResponse,
} from "@interopkit/core";
import { checkHttpsUrl, describe, hasMoreTokensThan } from "@interopkit/core/checks";
import { createTokenCache } from "@interopkit/core/oauth";
import { LtiError } from "../../errors.js";
import type { LtiDeployment } from "../../protocol/index.js";
import { MILLISECONDS } from "../../protocol/internal.js";
import { findDeployment } from "../options.js";
import { checkServiceUrl } from "../registration.js";
import { requestServiceToken } from "../token.js";
import type { ServiceClientSettings } from "./options.js";
import { keptToken, tokenKey } from "./token-store.js";

/** A page of what a service of the platform holds: the items, and the link to the next page. */
export interface Page<T> {
  /** The items of the page. */
  readonly items: readonly T[];
  /**
   * The next page: the `next` link of the answer, on the origin of the request, to pass to the same method as it is. Absent on
   * the last page, and when the link leads to another origin, so that the token never leaves the platform that answered.
   */
  readonly next?: string;
}

/** A request to a service: its method, the scopes that allow it, and its media types and body. */
interface ServiceRequestInit {
  /** The method. */
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  /** The scopes that allow the request, the narrowest first; the first that the platform offered is asked for. */
  readonly scopes: readonly string[];
  /**
   * The media type of the answer, sent as `Accept`.
   *
   * @defaultValue none
   */
  readonly accept?: string;
  /**
   * The body, as JSON, with its media type.
   *
   * @defaultValue none
   */
  readonly body?: { readonly type: string; readonly json: unknown };
  /**
   * The statuses beside 2xx that the call returns as values, such as 404.
   *
   * @defaultValue none
   */
  readonly expect?: readonly number[];
  /**
   * A bearer token that the platform gave for the URL, such as the registration access token of Dynamic Registration, which the
   * call sends in place of a token of its scopes.
   *
   * @defaultValue none: a token of the narrowest scope
   */
  readonly bearer?: string;
}

/** What the clients of the services share: the calls with a token, the limits, and the reading of answers and pages. */
export interface ServiceAccess {
  /** The settings of the client. */
  readonly settings: ServiceClientSettings;
  /**
   * Sends a request to a URL of a service of the platform, with a token for the narrowest scope that allows it.
   *
   * @remarks
   * The URL comes from a launch or an answer of the platform, so it must lie on one of the `serviceOrigins` of the
   * registration, or, without them, be an `https` URL that names a public host: the token goes nowhere else. The token is one
   * of the cache of its scope, and a 401 drops it, so that the next call asks for a new one; nothing retries. A `bearer` of the
   * request goes in its place, to the same addresses.
   *
   * @throws `LtiError` (`scope-unavailable`) when the platform offered none of the scopes, (`scope-denied`) when it did not
   * grant the one asked for, (`service-origin-refused`) when the URL may not receive the token, and (`platform-unknown`,
   * `deployment-unknown`) when the registration is gone or no longer lists the deployment.
   * @throws `ServiceError` when the token endpoint or the service does not answer with a success or an expected status.
   */
  request(url: string, init: ServiceRequestInit, options?: CallOptions): Promise<ServiceResponse>;
  /**
   * Reads the body of an answer as JSON within `maxTokens`, then with the reader of its model.
   *
   * @throws `DataError` when the body is not UTF-8 JSON, has more than `maxTokens` tokens, or breaks the model.
   */
  read<T>(response: ServiceResponse, what: string, reader: (value: unknown) => T): T;
  /** Returns the `next` link of an answer, on the origin of the request, or `undefined`. */
  next(response: ServiceResponse, url: string): string | undefined;
  /** Returns the link of an answer with a relation, such as `differences`, on the origin of the request, or `undefined`. */
  link(response: ServiceResponse, relation: string, url: string): string | undefined;
}

const DECODER = new TextDecoder("utf-8", { fatal: true });
/** The statuses of a success, which a call that also expects another status lists beside it. */
const SUCCESS: readonly number[] = Array.from({ length: 100 }, (_, offset) => 200 + offset);

/**
 * Reads the body of an answer as JSON within a number of tokens, then with the reader of its model.
 *
 * @param what - Names the service in the error, such as `The line item at https://...`.
 * @throws `DataError` when the body is not UTF-8 JSON, has more than `maxTokens` tokens, or breaks the model.
 */
export function readAnswer<T>(
  response: ServiceResponse,
  what: string,
  maxTokens: number,
  reader: (value: unknown) => T,
): T {
  let text: string;
  try {
    text = DECODER.decode(response.body);
  } catch {
    throw new DataError(`${what} answered with a body that is not UTF-8 text.`);
  }
  if (hasMoreTokensThan(text, maxTokens)) {
    throw new DataError(
      `${what} answered with a body of more than ${maxTokens} tokens of JSON, above the limit of the option maxTokens.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DataError(`${what} answered with a body that is not JSON.`);
  }
  return reader(json);
}

/** Returns the narrowest scope of a call that the platform offered. */
function scopeOf(scopes: readonly string[], offered: readonly string[]): string {
  const scope = scopes.find((candidate) => offered.includes(candidate));
  if (scope === undefined) {
    throw new LtiError(
      `The platform offered none of the scopes ${scopes.join(", ")}, which the call needs.`,
      "scope-unavailable",
    );
  }
  return scope;
}

/** Builds the request of a call: its method, its bearer token and media types, and its body as JSON. */
function requestOf(init: ServiceRequestInit, token: string): ServiceInit {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (init.accept !== undefined) headers.accept = init.accept;
  if (init.body === undefined) return { method: init.method, headers };
  headers["content-type"] = init.body.type;
  return { method: init.method, headers, body: JSON.stringify(init.body.json) };
}

/**
 * Adds the filters of a query to a URL, and a `limit` of `pageLimit` when neither the query nor the URL names one. Without a
 * `pageLimit` the request carries a `limit` only if the caller named it.
 */
export function withQuery(url: URL, filters: URLSearchParams, pageLimit?: number): string {
  for (const [name, value] of filters) url.searchParams.set(name, value);
  if (pageLimit !== undefined && !url.searchParams.has("limit")) url.searchParams.set("limit", String(pageLimit));
  return url.href;
}

/**
 * Returns the URL of a request for a container: the URL with the filters of the query, and a `limit`.
 *
 * @throws `DataError` when the URL is not an `https` URL.
 */
export function containerRequest(url: string, filters: URLSearchParams, pageLimit: number): string {
  checkHttpsUrl(url, "The URL of the container");
  return withQuery(new URL(url), filters, pageLimit);
}

/** The name of a URL in an error. */
const nameOf = (url: string): string => `The service at ${url}`;

/**
 * Creates the access to the services of a platform for one deployment: a token cache for each scope, the check of every URL
 * against the registration, and the limits of the answers.
 */
export function createServiceAccess(deployment: LtiDeployment, settings: ServiceClientSettings): ServiceAccess {
  const { options, offered } = settings;
  const caches = new Map<string, (call?: CallOptions) => Promise<string>>();

  const { tokens } = options;
  const timing = {
    clock: options.clock,
    skewMs: settings.refreshSkewSeconds * MILLISECONDS,
    timeoutMs: settings.timeoutMs,
  };

  /**
   * The token cache of a scope: the work of a token is shared by the callers of the scope, and no caller's signal ends it. With a
   * store of tokens, the work asks the store first and gives it the token it obtains.
   */
  const cacheOf = (scope: string): ((call?: CallOptions) => Promise<string>) => {
    const known = caches.get(scope);
    if (known !== undefined) return known;
    const key = tokenKey(deployment, [scope]);
    const cache = createTokenCache(
      async () => {
        const registration = await findDeployment({ ...options, signal: undefined }, deployment);
        const kept = tokens === undefined ? undefined : await keptToken(tokens, key, scope, timing);
        if (kept !== undefined) return kept;
        const call = { fetch: options.fetch, timeoutMs: settings.timeoutMs, clock: options.clock };
        const token = await requestServiceToken(registration, deployment.deploymentId, [scope], call);
        // The platform may grant fewer scopes than were asked (Security Framework section 4.1), and a token without the scope
        // would only meet a 403.
        if (!token.scopes.includes(scope)) {
          throw new LtiError(`The platform did not grant the scope ${describe(scope)}.`, "scope-denied");
        }
        // A token without an expiry is good for no known time, so no other process may take it.
        if (tokens !== undefined && token.expiresAt !== undefined) {
          await tokens.put(key, token, { signal: AbortSignal.timeout(settings.timeoutMs) });
        }
        return token;
      },
      { clock: options.clock, refreshSkewSeconds: settings.refreshSkewSeconds },
    );
    caches.set(scope, cache);
    return cache;
  };

  /** Drops the token of a scope that the platform no longer takes: the next call, in this process or another, asks for a new one. */
  const forget = async (
    scope: string,
    cache: (call?: CallOptions) => Promise<string>,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    if (caches.get(scope) === cache) caches.delete(scope);
    await tokens?.delete(tokenKey(deployment, [scope]), signal === undefined ? {} : { signal });
  };

  return {
    settings,
    async request(url, init, call = {}) {
      const signal = call.signal ?? options.signal;
      const registration = await findDeployment({ ...options, signal }, deployment);
      checkServiceUrl(url, registration, `The URL ${url}`);
      const service = {
        fetch: options.fetch,
        timeoutMs: settings.timeoutMs,
        ...(signal === undefined ? {} : { signal }),
      };
      const limits = {
        maxBytes: settings.maxBytes,
        ...(init.expect === undefined ? {} : { expect: [...SUCCESS, ...init.expect] }),
      };
      if (init.bearer !== undefined) {
        return requestService(service, nameOf(url), url, requestOf(init, init.bearer), limits);
      }
      const scope = scopeOf(init.scopes, offered);
      const cache = cacheOf(scope);
      const token = await cache({ signal });
      try {
        return await requestService(service, nameOf(url), url, requestOf(init, token), limits);
      } catch (error) {
        if (error instanceof ServiceError && error.status === 401) await forget(scope, cache, signal);
        throw error;
      }
    },
    read(response, what, reader) {
      return readAnswer(response, what, settings.maxTokens, reader);
    },
    next(response, url) {
      return findLinkTarget(response.headers, "next", url);
    },
    link(response, relation, url) {
      return findLinkTarget(response.headers, relation, url);
    },
  };
}
