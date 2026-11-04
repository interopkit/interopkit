import {
  type Clock,
  checkClock,
  clientOptionsEntries,
  DataError,
  DEFAULT_TIMEOUT_MS,
  type Fetch,
  ServiceError,
  SYSTEM_CLOCK,
} from "@interopkit/core";
import {
  checkAbortSignal,
  checkArray,
  checkFunction,
  checkNonNegativeInteger,
  checkPositiveInteger,
  describe,
  MAX_JSON_DEPTH,
  MAX_JSON_TOKENS,
  methodsSchema,
  parseWith,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { DEFAULT_MAX_JSON_LD_TOKENS } from "./json-text.js";
import type { ContextLoader, DataIntegritySuite, KeyResolver } from "./model/index.js";

/** The JOSE algorithms that a credential may be verified with: the RSA, ECDSA and EdDSA algorithms that Web Crypto runs (Open Badges 8.2.1). */
const VERIFICATION_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;

/** The algorithms that a verification accepts unless it is told others. */
const DEFAULT_ALGORITHMS: readonly string[] = ["RS256", "RS384", "RS512", "ES256", "ES384", "EdDSA"];

/** The seconds by which the time of a JWT, of a proof or of a validity period may differ from the clock of the verifier. */
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

/**
 * The most bytes of a credential, and of an answer that holds a credential or a document that one names, unless the host says
 * otherwise: a credential with its images embedded is the largest.
 */
const DEFAULT_MAX_BYTES = 1_048_576;

/**
 * The schemas of the options that several functions take, by name, all optional: a function declares the options it takes in a
 * `strictRecord` that spreads `optionsOf` of their names beside its own, so that it refuses every other option.
 */
const OPTION_ENTRIES = {
  ...clientOptionsEntries,
  fetch: v.optional(clientOptionsEntries.fetch),
  clock: v.optional(methodsSchema<Clock>("now")),
};

/** The names of the options in `OPTION_ENTRIES`. */
type OptionName = keyof typeof OPTION_ENTRIES;

/**
 * Returns the schemas of the options of the given names, to spread into the `strictRecord` of a function's options.
 *
 * @param names - The options that the function takes among those that several functions take.
 */
export function optionsOf<const TName extends OptionName>(
  ...names: readonly TName[]
): Pick<typeof OPTION_ENTRIES, TName> {
  return Object.fromEntries(names.map((name) => [name, OPTION_ENTRIES[name]])) as Pick<typeof OPTION_ENTRIES, TName>;
}

/**
 * Checks an option that is a flag, as a host passes it from JavaScript.
 *
 * @param value - The value of the option.
 * @param label - Names the option in the message, such as `The option allowUnboundKeys`.
 * @throws `DataError` when it is not `true` or `false`.
 */
export function checkFlag(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new DataError(`${label} must be true or false, found ${describe(value)}.`);
}

/** The schema of a `KeyResolver` that a host passes: an object with the functions `resolve` and `issuerKeys`. */
const keyResolverSchema = methodsSchema<KeyResolver>("resolve", "issuerKeys");

const suiteSchema = methodsSchema<DataIntegritySuite>("verify");

/** Checks the Data Integrity suites that a host passes, as an array of objects with a `verify` function and a `cryptosuite`. */
function readSuites(value: unknown): readonly DataIntegritySuite[] {
  checkArray(value, "The option suites must be an array");
  return value.map((suite, index) => {
    const read = parseWith(suiteSchema, suite, `The option suites[${index}]`);
    if (typeof read.cryptosuite !== "string" || read.cryptosuite === "") {
      throw new DataError(`The option suites[${index}] must name its cryptosuite.`);
    }
    return read;
  });
}

/** Checks the JOSE algorithms that a host accepts: some of those that Web Crypto runs. */
function readAlgorithms(value: unknown): readonly string[] {
  checkArray(value, "The option algorithms must be an array");
  const known: readonly unknown[] = VERIFICATION_ALGORITHMS;
  const refused = value.findIndex((algorithm) => !known.includes(algorithm));
  if (refused !== -1) {
    throw new DataError(
      `The option algorithms must list ${VERIFICATION_ALGORITHMS.join(", ")}, found ${describe(value[refused])}.`,
    );
  }
  return value.slice() as readonly string[];
}

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

/**
 * Checks the options of a fetch as a host passes them from JavaScript, and fills in the defaults: the `fetch`, `timeoutMs`
 * (10,000), `maxBytes` (1,048,576), `maxTokens` (1,000,000) and the `signal`.
 *
 * @param options - The options, which the caller has checked to be an object.
 * @throws `DataError` when an option is not valid.
 */
export function readFetchSettings(options: Readonly<Record<string, unknown>>): FetchSettings {
  const { fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, maxTokens = MAX_JSON_TOKENS } = options;
  const { signal } = options;
  if (fetch !== undefined) checkFunction(fetch, "The option fetch must be a function");
  checkPositiveInteger(timeoutMs, "The option timeoutMs");
  checkPositiveInteger(maxBytes, "The option maxBytes");
  checkPositiveInteger(maxTokens, "The option maxTokens");
  if (signal !== undefined) checkAbortSignal(signal, "The option signal");
  return { fetch: fetch as Fetch | undefined, timeoutMs, maxBytes, maxTokens, signal };
}

/**
 * Checks the options of a verification as a host passes them from JavaScript, and fills in the defaults: those of a fetch, and
 * the `keys`, which are required, the `clock`, the `contexts`, the `algorithms`, `clockSkewSeconds` (60), `allowUnboundKeys`
 * and `legacyProofs` (false), the `suites`, `maxInputBytes` (1,048,576), `maxDepth` (64) and `maxJsonLdTokens` (20,000).
 *
 * @param options - The options, which the caller has checked to be an object.
 * @throws `DataError` when an option is not valid.
 */
export function readTrustSettings(options: Readonly<Record<string, unknown>>): TrustSettings {
  const keys = parseWith(keyResolverSchema, options.keys, "The option keys");
  const { clock, contexts, algorithms = DEFAULT_ALGORITHMS, clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS } = options;
  const { allowUnboundKeys = false, legacyProofs = false, suites = [] } = options;
  const { maxInputBytes = DEFAULT_MAX_BYTES, maxDepth = MAX_JSON_DEPTH } = options;
  const { maxJsonLdTokens = DEFAULT_MAX_JSON_LD_TOKENS } = options;
  checkClock(clock);
  if (contexts !== undefined) checkFunction(contexts, "The option contexts must be a function");
  checkNonNegativeInteger(clockSkewSeconds, "The option clockSkewSeconds");
  checkFlag(allowUnboundKeys, "The option allowUnboundKeys");
  checkFlag(legacyProofs, "The option legacyProofs");
  checkPositiveInteger(maxInputBytes, "The option maxInputBytes");
  checkPositiveInteger(maxDepth, "The option maxDepth");
  checkPositiveInteger(maxJsonLdTokens, "The option maxJsonLdTokens");
  return {
    ...readFetchSettings(options),
    keys,
    clock: clock ?? SYSTEM_CLOCK,
    contexts: contexts as ContextLoader | undefined,
    algorithms: readAlgorithms(algorithms),
    clockSkewSeconds,
    allowUnboundKeys,
    legacyProofs,
    suites: readSuites(suites),
    maxInputBytes,
    maxDepth,
    maxJsonLdTokens,
  };
}

/** A `fetch` that fetches nothing, for a verification that was given none: each use is a service that did not answer. */
const NO_FETCH: Fetch = () => Promise.reject(new ServiceError("No fetch was given to verify with.", 0, ""));

/** Returns what to pass as `fetch` to a function that needs one: the host's, or one that says that none was given. */
export function fetchOf(settings: FetchSettings): Fetch {
  return settings.fetch ?? NO_FETCH;
}
