import { type CallOptions, DataError, DEFAULT_TIMEOUT_MS, type Fetch } from "@interopkit/core";
import {
  checkHttpsUrl,
  describe,
  guardSchema,
  MAX_JSON_TOKENS,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { CREDENTIAL_APIS, type CredentialApi } from "../model/index.js";
import { API_PATHS } from "../model/internal.js";

/** The most bytes of an answer that the client reads unless the host says otherwise: a page of credentials of a large CLR. */
const DEFAULT_MAX_BYTES = 16_777_216;

/** The number of credentials that the client asks for in one page, which is the default `limit` of the host in the specification's examples. */
const DEFAULT_PAGE_SIZE = 100;

/** What the host sets for a client of the Open Badges API or the CLR Standard API. */
export interface CredentialsClientOptions extends CallOptions {
  /** The API: `"badges"` for the Open Badges API (`/ims/ob/v3p0`), or `"clr"` for the CLR Standard API (`/ims/clr/v2p0`). */
  readonly api: CredentialApi;
  /** The address of the resource server before the path of the API, such as `https://badges.example.org`. */
  readonly baseUrl: string;
  /** The `fetch` that makes the requests: the global one, or a replacement. */
  readonly fetch: Fetch;
  /**
   * Returns the access token for a request. It is called before every request, so that it can return a token that was
   * refreshed (`createTokenCache` of `@interopkit/core/oauth` does), and it receives the `signal` of the call.
   */
  readonly token: (options?: CallOptions) => Promise<string>;
  /**
   * The most time in milliseconds that one request may take, from the request to the last byte of the answer.
   *
   * @defaultValue 10,000
   */
  readonly timeoutMs?: number;
  /**
   * The most bytes of one answer.
   *
   * @defaultValue 16,777,216
   */
  readonly maxBytes?: number;
  /**
   * The most tokens of JSON in one answer: each bracket, brace, colon and comma, each string, each number, and each of `true`,
   * `false` and `null`. The memory of a parse grows with the tokens and not with the bytes, so an answer over the limit is
   * refused before it is parsed.
   *
   * @defaultValue 1,000,000
   */
  readonly maxTokens?: number;
  /**
   * The number of credentials that `listCredentials` asks for in one request.
   *
   * @defaultValue 100
   */
  readonly pageSize?: number;
}

/** What the client uses of its configuration, after the checks and with the defaults. */
export interface Settings {
  readonly api: CredentialApi;
  readonly root: string;
  readonly fetch: Fetch;
  readonly token: CredentialsClientOptions["token"];
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxTokens: number;
  readonly pageSize: number;
  readonly signal: AbortSignal | undefined;
}

/** A base that already ends with the path of an API, which `apiRoot` would add a second time. */
const ENDS_WITH_API_PATH = /\/ims\/(?:ob\/v3p0|clr\/v2p0)\/*$/u;

/**
 * Returns the address that every endpoint of an API starts with: the base, without a trailing slash, and the path of the
 * API.
 *
 * @param baseUrl - The address of the resource server before the path of the API.
 * @param api - The API whose endpoints the address leads to.
 * @param label - Names the base in the error message, such as `The option baseUrl`.
 * @throws `DataError` when the base is not an absolute `https` URL without credentials, query or fragment, or ends with the
 * path of an API.
 */
export function apiRoot(baseUrl: unknown, api: CredentialApi, label: string): string {
  checkHttpsUrl(baseUrl, label);
  const url = new URL(baseUrl);
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new DataError(`${label} must have no credentials, query or fragment, found ${describe(baseUrl)}.`);
  }
  if (ENDS_WITH_API_PATH.test(url.pathname)) {
    throw new DataError(`${label} must be the address before ${API_PATHS[api]}, found ${describe(baseUrl)}.`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}${API_PATHS[api]}`;
}

/** A function, which the host passes in. */
const functionSchema = <TFunction>(guard: (value: unknown) => value is TFunction) => guardSchema(guard, "a function");

const configSchema = strictRecord({
  api: v.picklist(CREDENTIAL_APIS),
  baseUrl: v.string(),
  fetch: functionSchema((value): value is Fetch => typeof value === "function"),
  token: functionSchema((value): value is CredentialsClientOptions["token"] => typeof value === "function"),
  timeoutMs: v.optional(positiveIntegerSchema),
  maxBytes: v.optional(positiveIntegerSchema),
  maxTokens: v.optional(positiveIntegerSchema),
  pageSize: v.optional(positiveIntegerSchema),
  signal: v.optional(guardSchema((value): value is AbortSignal => value instanceof AbortSignal, "an AbortSignal")),
});

/**
 * Checks the configuration of the client, as a host passes it from JavaScript, and fills in the defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function settingsOf(config: unknown): Settings {
  const checked = parseWith(configSchema, config, "The configuration of the client");
  return {
    api: checked.api,
    root: apiRoot(checked.baseUrl, checked.api, "The option baseUrl"),
    fetch: checked.fetch,
    token: checked.token,
    timeoutMs: checked.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: checked.maxBytes ?? DEFAULT_MAX_BYTES,
    maxTokens: checked.maxTokens ?? MAX_JSON_TOKENS,
    pageSize: checked.pageSize ?? DEFAULT_PAGE_SIZE,
    signal: checked.signal,
  };
}
