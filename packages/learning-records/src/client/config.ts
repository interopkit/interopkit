import { type CallOptions, DataError, DEFAULT_TIMEOUT_MS, type Fetch } from "@interopkit/core";
import {
  describe,
  guardSchema,
  MAX_JSON_TOKENS,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { XAPI_VERSIONS, type XapiVersion } from "../model/index.js";

/** The most bytes of an answer that the client reads unless the host says otherwise: 10 MiB, the size of an LRS request. */
const DEFAULT_MAX_BYTES = 10_485_760;

/** What the host sets for a client of an LRS. */
export interface LrsClientConfig extends CallOptions {
  /** The address of the LRS before the resources, over HTTPS and ending in a slash: `https://lrs.example.org/xapi/`. */
  readonly endpoint: string;
  /** The `fetch` that makes the requests: the global one, or a replacement. */
  readonly fetch: Fetch;
  /**
   * The version of xAPI whose header and rules for preconditions the client uses.
   *
   * @defaultValue `"2.0.0"`
   */
  readonly version?: XapiVersion;
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
   * @defaultValue 10,485,760
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
}

/** What the client uses of its configuration, after the checks and with the defaults. */
export interface Settings {
  /** The address of the LRS, ending in a slash. */
  readonly root: string;
  /** The origin of the LRS, which a `more` address must have. */
  readonly origin: string;
  readonly fetch: Fetch;
  readonly version: XapiVersion;
  readonly authorization: LrsClientConfig["authorization"];
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxTokens: number;
  readonly signal: AbortSignal | undefined;
}

const configSchema = strictRecord({
  endpoint: v.string(),
  fetch: guardSchema((value): value is Fetch => typeof value === "function", "a function"),
  version: v.optional(v.picklist(XAPI_VERSIONS)),
  authorization: v.optional(
    guardSchema(
      (value): value is NonNullable<LrsClientConfig["authorization"]> => typeof value === "function",
      "a function",
    ),
  ),
  timeoutMs: v.optional(positiveIntegerSchema),
  maxBytes: v.optional(positiveIntegerSchema),
  maxTokens: v.optional(positiveIntegerSchema),
  signal: v.optional(guardSchema((value): value is AbortSignal => value instanceof AbortSignal, "an AbortSignal")),
});

/** Reads the address of the LRS: HTTPS, ending in a slash, with no credentials, query or fragment. */
function rootOf(endpoint: string): URL {
  const problem = `The option endpoint must be an https address that ends in a slash, such as https://lrs.example.org/xapi/, found ${describe(endpoint)}.`;
  let root: URL;
  try {
    root = new URL(endpoint);
  } catch {
    throw new DataError(problem);
  }
  if (root.protocol !== "https:" || root.username !== "" || root.password !== "" || !endpoint.endsWith("/")) {
    throw new DataError(problem);
  }
  if (root.search !== "" || root.hash !== "" || endpoint.includes("?") || endpoint.includes("#")) {
    throw new DataError(problem);
  }
  return root;
}

/**
 * Checks the configuration of the client, as a host passes it from JavaScript, and fills in the defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function settingsOf(config: unknown): Settings {
  const checked = parseWith(configSchema, config, "The configuration of the client");
  const root = rootOf(checked.endpoint);
  return {
    root: root.href,
    origin: root.origin,
    fetch: checked.fetch,
    version: checked.version ?? "2.0.0",
    authorization: checked.authorization,
    timeoutMs: checked.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: checked.maxBytes ?? DEFAULT_MAX_BYTES,
    maxTokens: checked.maxTokens ?? MAX_JSON_TOKENS,
    signal: checked.signal,
  };
}
