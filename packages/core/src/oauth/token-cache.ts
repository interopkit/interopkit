import type { CallOptions } from "../call-options.js";
import { checkFunction, checkPositiveInteger, checkRecord } from "../checks.js";
import { type Clock, checkClock, readClock } from "../clock.js";
import { createKeyedCache } from "../keyed-cache.js";
import type { AccessToken } from "./access-token.js";
import { MILLISECONDS_PER_SECOND } from "./time.js";

/** What a token cache needs. */
export interface TokenCacheOptions {
  /** Gives the time that a token's expiry is compared with. */
  readonly clock: Clock;
  /**
   * The seconds before its expiry at which a token counts as expired, so that a token is not used in the last moments of its
   * life.
   *
   * @defaultValue 60
   */
  readonly refreshSkewSeconds?: number;
}

/** The seconds before its expiry at which a cached token is replaced unless the host says otherwise. */
const DEFAULT_REFRESH_SKEW_SECONDS = 60;

/** The key of the one token that a cache holds. */
const TOKEN_KEY = "token";

/**
 * Makes a function that returns a current access token, and obtains a new one only when the last has expired.
 *
 * @remarks
 * Callers that arrive while a token is being obtained share that one call, which runs to its own timeout and receives no
 * caller's `signal`: a caller that aborts ends only its own wait. A token with no expiry is not kept, since nothing says
 * how long it is good, so each call obtains one, and callers that arrive together still share it. A failed call is not
 * kept: the next call tries again. Each cache holds one token, so a host that uses several clients makes several caches.
 *
 * @param obtain - Gets a new token, such as `requestClientCredentialsToken` with the client and scopes bound.
 * @param options - The clock and the skew.
 * @returns A function that returns the access token, as the string to send in `Authorization: Bearer`. It takes the `signal`
 * that ends the caller's wait.
 * @throws `DataError` when an argument is not valid.
 */
export function createTokenCache(
  obtain: (options?: CallOptions) => Promise<AccessToken>,
  options: TokenCacheOptions,
): (options?: CallOptions) => Promise<string> {
  checkFunction(obtain, "The function obtain must be a function");
  checkRecord(options, "The options of createTokenCache must be an object");
  checkClock(options.clock);
  if (options.refreshSkewSeconds !== undefined)
    checkPositiveInteger(options.refreshSkewSeconds, "The option refreshSkewSeconds");
  const { clock } = options;
  const skewMilliseconds = (options.refreshSkewSeconds ?? DEFAULT_REFRESH_SKEW_SECONDS) * MILLISECONDS_PER_SECOND;
  // One token, good until the skew before its expiry; a token with no expiry is shared by the callers that waited and not kept.
  const kept = createKeyedCache<AccessToken>({
    clock,
    maxEntries: 1,
    lifetime: ({ expiresAt }) => (expiresAt === undefined ? 0 : expiresAt - skewMilliseconds - readClock(clock)),
  });
  return async (callOptions) => (await kept.get(TOKEN_KEY, () => obtain(), callOptions)).accessToken;
}
