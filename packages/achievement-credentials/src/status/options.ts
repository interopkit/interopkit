import { type CallOptions, type Clock, checkClock, DataError, type Fetch } from "@interopkit/core";
import {
  checkAbortSignal,
  checkArray,
  checkFunction,
  checkNonEmptyString,
  checkNonNegativeInteger,
  checkPositiveInteger,
  checkRecord,
  checkString,
  describe,
  MAX_JSON_TOKENS,
  parseWith,
} from "@interopkit/core/checks";
import type { ContextLoader, DataIntegritySuite, KeyResolver } from "../model/index.js";
import { checkFlag, keyResolverSchema, readSuites } from "../option-checks.js";
import type { StatusList } from "./bitstring.js";
import type { StatusListCache } from "./status-list-cache.js";

/** What a status list credential is built from. */
export interface StatusListCredentialInput {
  /** The address of the status list credential: where verifiers fetch it. */
  readonly id: string;
  /** The `id` of the issuer, who also issues the credentials that name this list. */
  readonly issuer: string;
  /** When the list becomes valid, RFC 3339 with an offset. */
  readonly validFrom: string;
  /** What a set entry means. */
  readonly purpose: "revocation" | "suspension";
  /** The entries. */
  readonly list: StatusList;
  /**
   * When the list stops being valid, RFC 3339 with an offset.
   *
   * @defaultValue none
   */
  readonly validUntil?: string;
  /**
   * How long a verifier may keep the list before it fetches it again, in milliseconds.
   *
   * @defaultValue none: verifiers keep it 300,000 ms
   */
  readonly ttlMilliseconds?: number;
}

/** The options of `issueStatusListCredential`. */
export interface StatusIssueOptions extends CallOptions {
  /**
   * How the list credential is secured: a compact JWS, or a credential with a Data Integrity proof.
   *
   * @defaultValue `"jwt"`
   */
  readonly proof?: "jwt" | "data-integrity";
  /**
   * Returns the contexts, for a Data Integrity proof.
   *
   * @defaultValue none: required for a Data Integrity proof
   */
  readonly contexts?: ContextLoader;
  /** Gives the time of a Data Integrity proof. */
  readonly clock: Clock;
}

/** The options of `verifyCredentialStatus`. */
export interface StatusCheckOptions extends CallOptions {
  /** The `fetch` that gets the status list credential. */
  readonly fetch: Fetch;
  /** Resolves the keys that verify the list credential, and reads what its issuer publishes. */
  readonly keys: KeyResolver;
  /** Gives the time that the list credential's validity is compared with. */
  readonly clock: Clock;
  /**
   * Returns the contexts. Without it, a list credential with a Data Integrity proof cannot be checked and the status is
   * `unavailable`.
   *
   * @defaultValue none
   */
  readonly contexts?: ContextLoader;
  /**
   * Keeps list credentials across verifications.
   *
   * @defaultValue none: fetched for each verification
   */
  readonly cache?: StatusListCache;
  /**
   * Issuers other than the credential's that may publish its status list.
   *
   * @defaultValue none
   */
  readonly statusIssuers?: readonly string[];
  /**
   * The time that a fetch may take, in milliseconds.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
  /**
   * The most bytes of a list credential.
   *
   * @defaultValue `1048576`
   */
  readonly maxBytes?: number;
  /**
   * The most tokens of JSON in the list credential: the memory of a parse grows with the tokens and not with the bytes.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
  /**
   * The algorithms that may sign a list credential that is a JWT.
   *
   * @defaultValue `["RS256", "RS384", "RS512", "ES256", "ES384", "EdDSA"]`
   */
  readonly algorithms?: readonly string[];
  /**
   * The seconds that the time claims of a list credential that is a JWT may be off.
   *
   * @defaultValue `60`
   */
  readonly clockSkewSeconds?: number;
  /**
   * Accepts a list credential whose key its issuer does not publish. The status is then read from a list that nothing ties to
   * the issuer of the credential.
   *
   * @defaultValue `false`
   */
  readonly allowUnboundKeys?: boolean;
  /**
   * Accepts a list credential with an `Ed25519Signature2020` proof.
   *
   * @defaultValue `false`
   */
  readonly legacyProofs?: boolean;
  /**
   * More Data Integrity suites for a list credential, beside the built-in ones.
   *
   * @defaultValue none
   */
  readonly suites?: readonly DataIntegritySuite[];
}

/** The checked options of a status check. */
export interface CheckSettings {
  readonly fetch: Fetch;
  readonly keys: KeyResolver;
  readonly clock: Clock;
  readonly contexts: ContextLoader | undefined;
  readonly cache: StatusListCache | undefined;
  readonly statusIssuers: readonly string[];
  readonly timeoutMs: number | undefined;
  readonly maxBytes: number | undefined;
  readonly maxTokens: number;
  readonly algorithms: readonly string[] | undefined;
  readonly clockSkewSeconds: number | undefined;
  readonly allowUnboundKeys: boolean;
  readonly legacyProofs: boolean;
  readonly suites: readonly DataIntegritySuite[];
  readonly signal: AbortSignal | undefined;
}

/** Checks the options of `verifyCredentialStatus` as a host passes them from JavaScript. */
export function checkSettings(options: unknown): CheckSettings {
  checkRecord(options, "The options of verifyCredentialStatus must be an object");
  const { fetch, clock, contexts, cache, timeoutMs, maxBytes, signal, statusIssuers = [] } = options;
  const { maxTokens = MAX_JSON_TOKENS, algorithms, clockSkewSeconds } = options;
  const { allowUnboundKeys = false, legacyProofs = false, suites = [] } = options;
  checkFunction(fetch, "The option fetch must be a function");
  const keys = parseWith(keyResolverSchema, options.keys, "The option keys");
  checkClock(clock);
  if (contexts !== undefined) checkFunction(contexts, "The option contexts must be a function");
  if (cache !== undefined) {
    checkRecord(cache, "The option cache must be an object");
    checkFunction(cache.get, "The function get of the option cache must be a function");
  }
  checkArray(statusIssuers, "The option statusIssuers must be an array");
  for (const issuer of statusIssuers) checkString(issuer, "An issuer of the option statusIssuers");
  if (timeoutMs !== undefined) checkPositiveInteger(timeoutMs, "The option timeoutMs");
  if (maxBytes !== undefined) checkPositiveInteger(maxBytes, "The option maxBytes");
  checkPositiveInteger(maxTokens, "The option maxTokens");
  if (algorithms !== undefined) {
    checkArray(algorithms, "The option algorithms must be an array");
    for (const algorithm of algorithms) checkString(algorithm, "An algorithm of the option algorithms");
  }
  if (clockSkewSeconds !== undefined) checkNonNegativeInteger(clockSkewSeconds, "The option clockSkewSeconds");
  checkFlag(allowUnboundKeys, "The option allowUnboundKeys");
  checkFlag(legacyProofs, "The option legacyProofs");
  const checkedSuites = readSuites(suites);
  if (signal !== undefined) checkAbortSignal(signal, "The option signal");
  return {
    fetch: fetch as Fetch,
    keys,
    clock,
    contexts: contexts as ContextLoader | undefined,
    cache: cache as StatusListCache | undefined,
    statusIssuers: statusIssuers as readonly string[],
    timeoutMs,
    maxBytes,
    maxTokens,
    algorithms: algorithms as readonly string[] | undefined,
    clockSkewSeconds,
    allowUnboundKeys,
    legacyProofs,
    suites: checkedSuites,
    signal,
  };
}

/** The checked options of the issue of a list credential: a Data Integrity proof comes with the loader of contexts. */
export type IssueSettings = {
  readonly clock: Clock;
  readonly signal: AbortSignal | undefined;
} & ({ readonly proof: "jwt" } | { readonly proof: "data-integrity"; readonly contexts: ContextLoader });

/** Checks the options of `issueStatusListCredential` as a host passes them from JavaScript. */
export function issueSettings(options: unknown): IssueSettings {
  checkRecord(options, "The options of issueStatusListCredential must be an object");
  const { proof = "jwt", contexts, clock, signal } = options;
  if (proof !== "jwt" && proof !== "data-integrity") {
    throw new DataError(`The option proof must be jwt or data-integrity, found ${describe(proof)}.`);
  }
  checkClock(clock);
  if (signal !== undefined) checkAbortSignal(signal, "The option signal");
  if (proof === "jwt") return { proof, clock, signal };
  if (contexts === undefined) {
    throw new DataError(
      "The option contexts is required for a Data Integrity proof: it loads the contexts of the credential.",
    );
  }
  checkFunction(contexts, "The option contexts must be a function");
  return { proof, contexts: contexts as ContextLoader, clock, signal };
}

/** Checks the input of `issueStatusListCredential`. */
export function checkInput(input: unknown): asserts input is StatusListCredentialInput {
  checkRecord(input, "The status list credential input must be an object");
  checkNonEmptyString(input.id, "The id of the status list credential");
  checkNonEmptyString(input.issuer, "The issuer of the status list credential");
  checkNonEmptyString(input.validFrom, "The validFrom of the status list credential");
  if (input.purpose !== "revocation" && input.purpose !== "suspension") {
    throw new DataError(`The purpose must be revocation or suspension, found ${describe(input.purpose)}.`);
  }
  if (input.validUntil !== undefined)
    checkNonEmptyString(input.validUntil, "The validUntil of the status list credential");
  if (input.ttlMilliseconds !== undefined) checkPositiveInteger(input.ttlMilliseconds, "The ttlMilliseconds");
}
