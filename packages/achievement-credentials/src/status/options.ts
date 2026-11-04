import { type CallOptions, type Clock, checkClock, DataError, type Fetch, SYSTEM_CLOCK } from "@interopkit/core";
import {
  checkAbortSignal,
  checkArray,
  checkFunction,
  checkNonEmptyString,
  checkPositiveInteger,
  checkRecord,
  describe,
} from "@interopkit/core/checks";
import type { ContextLoader, DataIntegritySuite, KeyResolver } from "../model/index.js";
import { readTrustSettings, type TrustSettings } from "../option-checks.js";
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
  readonly ttlMs?: number;
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
  /**
   * Gives the time of a Data Integrity proof.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
}

/** The options of `verifyCredentialStatus`. */
export interface StatusCheckOptions extends CallOptions {
  /** The `fetch` that gets the status list credential. */
  readonly fetch: Fetch;
  /** Resolves the keys that verify the list credential, and reads what its issuer publishes. */
  readonly keys: KeyResolver;
  /**
   * Gives the time that the list credential's validity is compared with.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /**
   * Returns the contexts. Without it, a list credential with a Data Integrity proof cannot be checked and the status is
   * `unavailable`.
   *
   * @defaultValue none
   */
  readonly contexts?: ContextLoader;
  /**
   * Keeps list credentials across verifications, until their `ttl` or `validUntil`.
   *
   * @defaultValue none: fetched for each verification
   */
  readonly statusLists?: StatusListCache;
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
   * The most characters of a list credential that is a compact JWS, and of one with a Data Integrity proof as JSON.
   *
   * @defaultValue `1048576`
   */
  readonly maxInputBytes?: number;
  /**
   * The most levels that the JSON of the list credential nests.
   *
   * @defaultValue `64`
   */
  readonly maxDepth?: number;
  /**
   * The most tokens of JSON in a list credential with a Data Integrity proof, which a JSON-LD processor reads to check it.
   *
   * @defaultValue `20000`
   */
  readonly maxJsonLdTokens?: number;
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

/** The settings of a status check, checked and with their defaults: those of every verification, and of the status lists. */
export interface StatusSettings extends TrustSettings {
  readonly statusLists: StatusListCache | undefined;
  readonly statusIssuers: readonly string[];
}

/**
 * Checks the options of a status check as a host passes them from JavaScript, and fills in the defaults: those of every
 * verification, `statusLists` and `statusIssuers`.
 *
 * @param options - The options, which the caller has checked to be an object.
 * @throws `DataError` when an option is not valid.
 */
export function readStatusSettings(options: Readonly<Record<string, unknown>>): StatusSettings {
  const { statusLists, statusIssuers = [] } = options;
  if (statusLists !== undefined) {
    checkRecord(statusLists, "The option statusLists must be an object");
    checkFunction(statusLists.get, "The function get of the option statusLists must be a function");
  }
  checkArray(statusIssuers, "The option statusIssuers must be an array");
  for (const issuer of statusIssuers) checkNonEmptyString(issuer, "An issuer of the option statusIssuers");
  return {
    ...readTrustSettings(options),
    statusLists: statusLists as StatusListCache | undefined,
    statusIssuers: statusIssuers as readonly string[],
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
  const given = clock ?? SYSTEM_CLOCK;
  if (proof === "jwt") return { proof, clock: given, signal };
  if (contexts === undefined) {
    throw new DataError(
      "The option contexts is required for a Data Integrity proof: it loads the contexts of the credential.",
    );
  }
  checkFunction(contexts, "The option contexts must be a function");
  return { proof, contexts: contexts as ContextLoader, clock: given, signal };
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
  if (input.ttlMs !== undefined) checkPositiveInteger(input.ttlMs, "The ttlMs");
}
