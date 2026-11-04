import {
  type CallOptions,
  type Clock,
  callService,
  checkClock,
  createKeyedCache,
  DataError,
  DEFAULT_TIMEOUT_MS,
  type Fetch,
  LimitError,
} from "@interopkit/core";
import { checkFunction, checkHttpsUrl, checkPositiveInteger, checkRecord, isRecord } from "@interopkit/core/checks";
import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTVerifyGetKey } from "jose";

const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_REFRESH_SECONDS = 60;
/** The most key sets that a cache keeps: the one fetched first goes first. */
const MAX_KEY_SETS = 1000;
/**
 * The most keys of a key set: a party publishes its current key and those of a rotation. jose copies each key and keeps a note of
 * it, so that a set of 64 KiB of empty keys would take some 20 MiB to read.
 */
const MAX_KEYS = 100;

/** The options of `createJwksCache`. */
export interface JwksCacheOptions {
  /** The `fetch` that gets the key sets. */
  readonly fetch: Fetch;
  /**
   * Gives the time that the lifetimes of the key sets are counted by.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /**
   * How long a key set stays in the cache, in seconds.
   *
   * @defaultValue `3600`
   */
  readonly ttlSeconds?: number;
  /**
   * The least time between two fetches of one key set, in seconds. A `kid` that the cached set lacks fetches it again
   * only after this time, so that a party that rotates its keys is followed, and a token with an invented `kid`
   * cannot make the cache fetch on every request.
   *
   * @defaultValue `60`
   */
  readonly refreshSeconds?: number;
  /**
   * The most time that a fetch may take, in milliseconds.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
}

/** The public keys that parties sign their tokens with, cached by the URL of their JWK Set. */
export interface JwksCache {
  /**
   * Returns the key set at a URL as the function that resolves the public key of a token from its header, for `jwtVerify`
   * of jose. The cache fetches the set when it holds none or an old one, and again when the set lacks the `kid` and the
   * refresh time has passed. It uses the key that has the `kid` and is for signing with the algorithm of the token, and
   * refuses a `kid` that two keys share.
   *
   * @remarks
   * A fetch is shared work: it runs to `timeoutMs` and takes no caller's signal. The `signal` of `options` ends the wait
   * of the caller that holds the function and no other.
   *
   * @param url - The address of the key set, an `https` URL.
   * @param options - The `signal` that ends the caller's wait.
   * @throws `DataError` when `url` is not an `https` URL.
   */
  keySet(url: string, options?: CallOptions): JWTVerifyGetKey;
}

/** Tells whether a value has the list of keys of a JWK Set, whose members jose then checks. */
function hasKeys(value: unknown): value is JSONWebKeySet {
  return isRecord(value) && Array.isArray(value.keys);
}

/** Reads the text of a key set into the function of jose that picks a key from it. */
function readKeySet(text: string, url: string): JWTVerifyGetKey {
  const refusal = (cause?: unknown) =>
    new DataError(
      `The key set at ${url} must be a JWK Set (RFC 7517 section 5).`,
      cause === undefined ? undefined : { cause },
    );
  let set: unknown;
  try {
    // The text has at most 64 KiB, which bounds what its parse holds.
    set = JSON.parse(text);
  } catch (error) {
    throw refusal(error);
  }
  if (!hasKeys(set)) throw refusal();
  if (set.keys.length > MAX_KEYS) {
    throw new LimitError(
      `The key set at ${url} has ${set.keys.length} keys, above the limit of ${MAX_KEYS}.`,
      "maxKeys",
      MAX_KEYS,
    );
  }
  try {
    return createLocalJWKSet(set);
  } catch (error) {
    // jose throws a JWKSInvalid for a key that is not an object.
    throw refusal(error);
  }
}

/**
 * Creates a cache of JWK Sets by their URL, such as those of the platforms that launch a tool or of the tools that a
 * platform launches.
 *
 * @remarks
 * The cache keeps up to 1,000 key sets of up to 100 keys, and the URLs come from the host's registrations, never from a
 * token. A fetch is shared by the requests that wait for it. The key sets are fetched with the `fetch` of the host, without
 * redirects, within `timeoutMs` and up to 64 KiB. A set that cannot be fetched or read is not kept, and is never served past
 * `ttlSeconds`.
 *
 * @param options - The `fetch`, the clock, the lifetimes and the timeout.
 * @returns The cache.
 * @throws `DataError` when an option has the wrong type.
 * @see {@link https://www.rfc-editor.org/rfc/rfc7517#section-5 | RFC 7517, section 5}
 */
export function createJwksCache(options: JwksCacheOptions): JwksCache {
  checkRecord(options, "The options must be an object");
  const { fetch, clock, ttlSeconds = DEFAULT_TTL_SECONDS, refreshSeconds = DEFAULT_REFRESH_SECONDS } = options;
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  checkFunction(fetch, "The option fetch must be a function");
  checkClock(clock);
  checkPositiveInteger(ttlSeconds, "The option ttlSeconds");
  checkPositiveInteger(refreshSeconds, "The option refreshSeconds");
  checkPositiveInteger(timeoutMs, "The option timeoutMs");
  const refreshAfter = refreshSeconds * MILLISECONDS_PER_SECOND;
  const sets = createKeyedCache<JWTVerifyGetKey>({
    clock,
    lifetime: () => ttlSeconds * MILLISECONDS_PER_SECOND,
    maxEntries: MAX_KEY_SETS,
  });

  const load = (url: string) => async () =>
    readKeySet(
      await callService({ fetch, timeoutMs }, `The key set at ${url}`, url, {
        method: "GET",
        headers: { accept: "application/json" },
      }),
      url,
    );

  return {
    keySet(url, callOptions) {
      checkHttpsUrl(url, "The URL of a key set");
      return async (header, token) => {
        const kept = await sets.get(url, load(url), callOptions);
        try {
          return await kept(header, token);
        } catch (error) {
          if (!(error instanceof errors.JWKSNoMatchingKey)) throw error;
          // A key that the set lacks may have been added since: fetch the set again, but at most once a refresh time.
          const fetched = await sets.get(url, load(url), callOptions, refreshAfter);
          if (fetched === kept) throw error;
          return await fetched(header, token);
        }
      };
    },
  };
}

/**
 * Checks a cache, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a function `keySet`.
 */
export function checkJwksCache(value: unknown): asserts value is JwksCache {
  checkRecord(value, "The option jwks must be an object");
  checkFunction(value.keySet, "The function keySet of the option jwks must be a function");
}
