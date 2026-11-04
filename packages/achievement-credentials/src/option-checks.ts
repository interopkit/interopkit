import { type Clock, DEFAULT_TIMEOUT_MS, type Fetch, ServiceError, SYSTEM_CLOCK } from "@interopkit/core";
import { MAX_JSON_DEPTH, MAX_JSON_TOKENS } from "@interopkit/core/checks";
import { DEFAULT_MAX_JSON_LD_TOKENS } from "./json-text.js";
import type { ContextLoader, DataIntegritySuite, KeyResolver } from "./model/index.js";

/** The algorithms that a verification accepts unless it is told others. */
const DEFAULT_ALGORITHMS: readonly string[] = ["RS256", "RS384", "RS512", "ES256", "ES384", "EdDSA"];

/** The seconds by which the time of a JWT, of a proof or of a validity period may differ from the clock of the verifier. */
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

/**
 * The most bytes of a credential, and of an answer that holds a credential or a document that one names, unless the host says
 * otherwise: a credential with its images embedded is the largest.
 */
const DEFAULT_MAX_BYTES = 1_048_576;

/** The fetch of a document that a credential names, with its limits, checked and with their defaults. */
export interface FetchSettings {
  /** The `fetch` of the host, or undefined when it gave none. */
  readonly fetch: Fetch | undefined;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  /** The most tokens of JSON in a text that the package parses: a document, a credential, a JWS. */
  readonly maxTokens: number;
  readonly signal: AbortSignal | undefined;
}

/**
 * The settings that decide whether a proof counts, and the limits of what a verification reads and fetches, checked once by the
 * public function that reads them, with their defaults. The functions that a verification calls take them as they are.
 */
export interface TrustSettings extends FetchSettings {
  readonly keys: KeyResolver;
  readonly clock: Clock;
  readonly contexts: ContextLoader | undefined;
  readonly algorithms: readonly string[];
  readonly clockSkewSeconds: number;
  readonly allowUnboundKeys: boolean;
  readonly legacyProofs: boolean;
  readonly suites: readonly DataIntegritySuite[];
  readonly maxInputBytes: number;
  readonly maxDepth: number;
  readonly maxJsonLdTokens: number;
}

/** The options of a fetch that a function has parsed with its schema, each left out when the function does not take it. */
export interface FetchOptions {
  readonly fetch?: Fetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxBytes?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** The options of a verification that a function has parsed with its schema, each left out when the function does not take it. */
export interface TrustOptions extends FetchOptions {
  readonly keys: KeyResolver;
  readonly clock?: Clock | undefined;
  readonly contexts?: ContextLoader | undefined;
  readonly algorithms?: readonly string[] | undefined;
  readonly clockSkewSeconds?: number | undefined;
  readonly allowUnboundKeys?: boolean | undefined;
  readonly legacyProofs?: boolean | undefined;
  readonly suites?: readonly DataIntegritySuite[] | undefined;
  readonly maxInputBytes?: number | undefined;
  readonly maxDepth?: number | undefined;
  readonly maxJsonLdTokens?: number | undefined;
}

/**
 * Fills in the defaults of the options of a fetch: `timeoutMs` (10,000), `maxBytes` (1,048,576) and `maxTokens` (1,000,000).
 *
 * @param options - The options, parsed by the schema of the function that reads them.
 */
export function readFetchSettings(options: FetchOptions): FetchSettings {
  const { fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, maxTokens = MAX_JSON_TOKENS } = options;
  return { fetch, timeoutMs, maxBytes, maxTokens, signal: options.signal };
}

/**
 * Fills in the defaults of the options of a verification: those of a fetch, and the `clock`, `algorithms`,
 * `clockSkewSeconds` (60), `allowUnboundKeys` and `legacyProofs` (false), the `suites`, `maxInputBytes` (1,048,576),
 * `maxDepth` (64) and `maxJsonLdTokens` (20,000).
 *
 * @param options - The options, parsed by the schema of the function that reads them.
 */
export function readTrustSettings(options: TrustOptions): TrustSettings {
  return {
    ...readFetchSettings(options),
    keys: options.keys,
    clock: options.clock ?? SYSTEM_CLOCK,
    contexts: options.contexts,
    algorithms: options.algorithms ?? DEFAULT_ALGORITHMS,
    clockSkewSeconds: options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS,
    allowUnboundKeys: options.allowUnboundKeys ?? false,
    legacyProofs: options.legacyProofs ?? false,
    suites: options.suites ?? [],
    maxInputBytes: options.maxInputBytes ?? DEFAULT_MAX_BYTES,
    maxDepth: options.maxDepth ?? MAX_JSON_DEPTH,
    maxJsonLdTokens: options.maxJsonLdTokens ?? DEFAULT_MAX_JSON_LD_TOKENS,
  };
}

/** A `fetch` that fetches nothing, for a verification that was given none: each use is a service that did not answer. */
const NO_FETCH: Fetch = () => Promise.reject(new ServiceError("No fetch was given to verify with.", 0, ""));

/** Returns what to pass as `fetch` to a function that needs one: the host's, or one that says that none was given. */
export function fetchOf(settings: FetchSettings): Fetch {
  return settings.fetch ?? NO_FETCH;
}
