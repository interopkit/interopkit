import { type CallOptions, clientOptionsEntries, DEFAULT_TIMEOUT_MS, type Fetch } from "@interopkit/core";
import { guardSchema, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { CASE_VERSIONS, type CaseVersion } from "../model/index.js";
import { serviceRoot } from "../model/internal.js";

/** The most bytes of an answer that the client reads unless the host says otherwise: a package of a large framework. */
const DEFAULT_MAX_BYTES = 16_777_216;

/**
 * The most tokens of JSON in an answer that the client reads unless the host says otherwise. A framework of 10,000 items has
 * 990,000 tokens, and the largest answer by default, 16 MiB, has about 1,600,000 when it is a framework.
 */
const DEFAULT_MAX_TOKENS = 2_000_000;

/** The number of records that the client asks for in one page, which the REST binding gives as the default `limit`. */
const DEFAULT_PAGE_SIZE = 100;

/** What the host sets for a client of a CASE provider. */
export interface CaseClientOptions extends CallOptions {
  /** The address of the provider before the path of the version, such as `https://standards.example.org`. */
  readonly baseUrl: string;
  /** The `fetch` that makes the requests: the global one, or a replacement. */
  readonly fetch: Fetch;
  /**
   * The version of CASE whose path and rules the client uses. Answers are read as that version.
   *
   * @defaultValue `"1.1"`
   */
  readonly version?: CaseVersion;
  /**
   * Returns the value of the `Authorization` header for a request, such as `Bearer abc`, or `undefined` to send none. It is
   * called before every request, so that it can return a token that was refreshed, and it receives the `signal` of the call.
   *
   * @defaultValue none: requests carry no credential
   */
  readonly authorization?: (options?: CallOptions) => Promise<string | undefined>;
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
   * @defaultValue 2,000,000
   */
  readonly maxTokens?: number;
  /**
   * The number of documents that `documents` asks for in one request.
   *
   * @defaultValue 100
   */
  readonly pageSize?: number;
}

/** What the client uses of its configuration, after the checks and with the defaults. */
export interface Settings {
  readonly root: string;
  readonly fetch: Fetch;
  readonly version: CaseVersion;
  readonly authorization: CaseClientOptions["authorization"];
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxTokens: number;
  readonly pageSize: number;
  readonly signal: AbortSignal | undefined;
}

const configSchema = strictRecord({
  baseUrl: v.string(),
  version: v.optional(v.picklist(CASE_VERSIONS)),
  authorization: v.optional(
    guardSchema(
      (value): value is NonNullable<CaseClientOptions["authorization"]> => typeof value === "function",
      "a function",
    ),
  ),
  ...clientOptionsEntries,
  pageSize: v.optional(positiveIntegerSchema),
});

/**
 * Checks the configuration of the client, as a host passes it from JavaScript, and fills in the defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function settingsOf(config: unknown): Settings {
  const checked = parseWith(configSchema, config, "The configuration of the client");
  const version = checked.version ?? "1.1";
  return {
    root: serviceRoot(checked.baseUrl, version, "The option baseUrl"),
    fetch: checked.fetch,
    version,
    authorization: checked.authorization,
    timeoutMs: checked.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: checked.maxBytes ?? DEFAULT_MAX_BYTES,
    maxTokens: checked.maxTokens ?? DEFAULT_MAX_TOKENS,
    pageSize: checked.pageSize ?? DEFAULT_PAGE_SIZE,
    signal: checked.signal,
  };
}
