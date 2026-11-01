import { type CallOptions, type Clock, checkClock, readClock } from "@interopkit/core";
import { checkPositiveInteger, checkRecord, isRecord } from "@interopkit/core/checks";
import { createKeyedCache } from "../keyed-cache.js";
import type { VerifiableCredential } from "../model/index.js";

/** Status list credentials kept across verifications, by address. */
export interface StatusListCache {
  /**
   * Returns the status list credential at an address: the kept one while it is good, else the result of `load`.
   *
   * @remarks
   * A load is shared work: callers that ask while it runs share one, which runs to its own timeout and receives no caller's
   * `signal`. An entry expires at its `ttl` (300,000 ms when it gives none) or at its `validUntil`, whichever comes first, and
   * a failed load is not kept.
   *
   * @param url - The address of the status list credential.
   * @param load - Fetches the credential and checks it.
   * @param options - The `signal` that ends the caller's wait.
   */
  get(
    url: string,
    load: (options?: CallOptions) => Promise<VerifiableCredential>,
    options?: CallOptions,
  ): Promise<VerifiableCredential>;
}

/** The options of `createStatusListCache`. */
export interface StatusListCacheOptions {
  /** Gives the time that entries expire by. */
  readonly clock: Clock;
  /**
   * The most credentials kept: the oldest goes first.
   *
   * @defaultValue `1000`
   */
  readonly maxEntries?: number;
}

/** How long a status list credential stays good when it says nothing (Bitstring Status List 3.1, `ttl`), in milliseconds. */
const DEFAULT_TTL_MILLISECONDS = 300_000;

const DEFAULT_MAX_ENTRIES = 1000;

/** Reads the `ttl` of a status list credential in milliseconds: its subject's, or the default when it has none that fits. */
function ttlOf(credential: VerifiableCredential): number {
  const subject: unknown = credential.credentialSubject;
  const ttl = isRecord(subject) ? subject.ttl : undefined;
  return typeof ttl === "number" && Number.isSafeInteger(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_MILLISECONDS;
}

/**
 * Makes a cache of status list credentials, so that a list is fetched once for the verifications that need it, and again when
 * it expires.
 *
 * @param options - The clock and the most entries.
 * @returns The cache.
 * @throws `DataError` when an option is not valid.
 * @see {@link https://www.w3.org/TR/vc-bitstring-status-list/#bitstringstatuslistcredential | Bitstring Status List, ttl}
 */
export function createStatusListCache(options: StatusListCacheOptions): StatusListCache {
  checkRecord(options, "The options of createStatusListCache must be an object");
  checkClock(options.clock);
  const { clock, maxEntries = DEFAULT_MAX_ENTRIES } = options;
  checkPositiveInteger(maxEntries, "The option maxEntries");
  const kept = createKeyedCache<VerifiableCredential>({
    clock,
    maxEntries,
    lifetime(credential) {
      const untilExpiry =
        credential.validUntil === undefined ? Infinity : Date.parse(credential.validUntil) - readClock(clock);
      return Math.min(ttlOf(credential), untilExpiry);
    },
  });
  return {
    get: (url, load, callOptions) => kept.get(url, () => load(), callOptions),
  };
}
