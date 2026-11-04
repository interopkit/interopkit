import type { CallOptions } from "./call-options.js";
import { checkFunction, checkPositiveInteger, checkRecord, readCallOptions } from "./checks.js";
import { type Clock, checkClock, readClock } from "./clock.js";
import { raceAbort } from "./race-abort.js";

/** What a cache keeps: the value, when it was loaded and when it stops being good, in milliseconds since 1970. */
interface Entry<TValue> {
  readonly value: TValue;
  readonly loadedAt: number;
  readonly expiresAt: number;
}

/** What `createKeyedCache` needs. */
export interface KeyedCacheOptions<TValue> {
  /**
   * Gives the time that entries expire by.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /** Tells how long a loaded value stays good, in milliseconds from now. A value for zero or less is not kept. */
  readonly lifetime: (value: TValue) => number;
  /** The most entries kept: the one loaded first goes first. */
  readonly maxEntries: number;
}

/** A cache of values by key, whose loads are shared work. */
export interface KeyedCache<TValue> {
  /**
   * Returns the value of a key: the kept one while it is good, else the result of `load`.
   *
   * @remarks
   * Callers that ask for a key while it loads share that one load, which runs to its own timeout and receives no caller's
   * `signal`: a caller that aborts ends only its own wait. A failed load is not kept, and the next call loads again.
   *
   * @param key - What identifies the value.
   * @param load - Obtains the value.
   * @param options - The `signal` that ends the caller's wait.
   * @param reloadAfter - Loads again when the kept value was loaded this many milliseconds ago or more, although it is still
   * good. It lets a caller that misses something in a document fetch the document again, but not on every miss.
   */
  get(key: string, load: () => Promise<TValue>, options?: CallOptions, reloadAfter?: number): Promise<TValue>;
}

/**
 * Makes a cache of values by key, with the lifetime of each value, a bound on its size and loads shared by the callers that
 * wait for them: the shared work of a key set, a document, a status list or a token, which many requests need at once.
 *
 * @remarks
 * A load runs to its own deadline, which the `load` sets, and is kept when it succeeds; the key that was loaded first is dropped
 * first once the cache holds `maxEntries`. A value whose lifetime is zero or less is shared by the callers that waited for it
 * and is not kept.
 *
 * @param options - The clock, the lifetime of a value and the most entries.
 * @returns The cache.
 * @throws `DataError` when an option is not valid.
 */
export function createKeyedCache<TValue>(options: KeyedCacheOptions<TValue>): KeyedCache<TValue> {
  checkRecord(options, "The options of createKeyedCache must be an object");
  checkClock(options.clock);
  checkFunction(options.lifetime, "The option lifetime must be a function");
  checkPositiveInteger(options.maxEntries, "The option maxEntries");
  const { clock, lifetime, maxEntries } = options;
  const kept = new Map<string, Entry<TValue>>();
  const loading = new Map<string, Promise<TValue>>();

  const keep = (key: string, value: TValue): void => {
    const now = readClock(clock);
    const remaining = lifetime(value);
    // Deleting first moves a replaced key to the end, so that the oldest load is the first key.
    kept.delete(key);
    if (remaining <= 0) return;
    kept.set(key, { value, loadedAt: now, expiresAt: now + remaining });
    for (const oldest of kept.keys()) {
      if (kept.size <= maxEntries) break;
      kept.delete(oldest);
    }
  };

  const start = (key: string, load: () => Promise<TValue>): Promise<TValue> => {
    const shared = load().then((value) => {
      keep(key, value);
      return value;
    });
    loading.set(key, shared);
    const clear = (): void => {
      if (loading.get(key) === shared) loading.delete(key);
    };
    shared.then(clear, clear);
    return shared;
  };

  return {
    async get(key, load, options, reloadAfter) {
      const callOptions = readCallOptions(options);
      callOptions.signal?.throwIfAborted();
      const entry = kept.get(key);
      if (entry !== undefined) {
        const now = readClock(clock);
        const recent = reloadAfter === undefined || now - entry.loadedAt < reloadAfter;
        if (now < entry.expiresAt && recent) return entry.value;
      }
      return await raceAbort(loading.get(key) ?? start(key, load), callOptions);
    },
  };
}
