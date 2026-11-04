import { clientOptionsEntries, DEFAULT_TIMEOUT_MS, type Fetch } from "@interopkit/core";
import {
  MAX_JSON_TOKENS,
  methodsSchema,
  nonEmptyStringSchema,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { type ToolOptions, toolOptionsEntries } from "../options.js";
import type { TokenStore } from "./token-store.js";

/** The most bytes of an answer of a service by default: a page of a hundred line items, results or members is far less. */
const DEFAULT_MAX_BYTES = 1_048_576;
/** The `limit` that a request for a container sends unless its query names one. */
const DEFAULT_PAGE_LIMIT = 100;
/** The seconds before its expiry at which a cached token is replaced. */
const DEFAULT_REFRESH_SKEW_SECONDS = 60;

/** The options of `createServiceClient`. */
export interface ServiceClientOptions extends ToolOptions {
  /** The `fetch` that calls the platform's token endpoint and its services. */
  readonly fetch: Fetch;
  /**
   * The scopes that the platform offered in the claims of the launch, such as the `scopes` of `services.grades`; each call asks
   * for the narrowest of them that it needs.
   */
  readonly scopes: readonly string[];
  /**
   * The most time that each call may take, in milliseconds.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
  /**
   * The most bytes of an answer; a larger one is a `ServiceError` that names this option.
   *
   * @defaultValue `1048576`
   */
  readonly maxBytes?: number;
  /**
   * The most JSON tokens of an answer, counted before it is parsed; a larger one is a `DataError` that names this option.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
  /**
   * The `limit` that a request for a container sends when neither its query nor its URL names one; the platform may send
   * fewer or more.
   *
   * @defaultValue `100`
   */
  readonly pageLimit?: number;
  /**
   * The seconds before its expiry at which a cached token is replaced.
   *
   * @defaultValue `60`
   */
  readonly refreshSkewSeconds?: number;
  /**
   * The store of the access tokens that the clients of several processes share. A client asks it for a token of a scope when it
   * has none in its own memory, and gives it each token that it obtains with an expiry; a token without one is not stored.
   *
   * @defaultValue none: each client keeps its tokens in its own memory
   */
  readonly tokens?: TokenStore;
}

/** The options of a service client with their defaults filled in. */
export interface ServiceClientSettings {
  /** The options as the host gave them. */
  readonly options: ServiceClientOptions;
  /** The scopes that the platform offered. */
  readonly offered: readonly string[];
  /** The deadline of a call, in milliseconds. */
  readonly timeoutMs: number;
  /** The most bytes of an answer. */
  readonly maxBytes: number;
  /** The most JSON tokens of an answer. */
  readonly maxTokens: number;
  /** The `limit` of a request for a container. */
  readonly pageLimit: number;
  /** The seconds before its expiry at which a token is replaced. */
  readonly refreshSkewSeconds: number;
}

const optionsSchema = strictRecord({
  ...toolOptionsEntries,
  ...clientOptionsEntries,
  scopes: v.array(nonEmptyStringSchema),
  pageLimit: v.optional(positiveIntegerSchema),
  refreshSkewSeconds: v.optional(positiveIntegerSchema),
  tokens: v.optional(methodsSchema<TokenStore>("get", "put", "delete")),
});

/**
 * Checks the options of `createServiceClient` and fills in their defaults.
 *
 * @throws `DataError` when they are not.
 */
export function readServiceClientOptions(options: unknown): ServiceClientSettings {
  const read = parseWith(optionsSchema, options, "The options");
  return {
    options: read,
    offered: read.scopes,
    timeoutMs: read.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: read.maxBytes ?? DEFAULT_MAX_BYTES,
    maxTokens: read.maxTokens ?? MAX_JSON_TOKENS,
    pageLimit: read.pageLimit ?? DEFAULT_PAGE_LIMIT,
    refreshSkewSeconds: read.refreshSkewSeconds ?? DEFAULT_REFRESH_SKEW_SECONDS,
  };
}
