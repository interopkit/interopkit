import type { JwksCache } from "@interopkit/core";
import { checkFunction, checkRecord } from "@interopkit/core/checks";

// The cache is a part of core; the package exports it too, so that a host imports it with the functions that take it.
export { createJwksCache, type JwksCache, type JwksCacheOptions } from "@interopkit/core";

/**
 * Checks a cache, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a function `keySet`.
 */
export function checkJwksCache(value: unknown): asserts value is JwksCache {
  checkRecord(value, "The option jwks must be an object");
  checkFunction(value.keySet, "The function keySet of the option jwks must be a function");
}
