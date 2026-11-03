/**
 * The foundation that the interopkit packages share: their errors, a clock, the options of a call that waits on I/O, a cache of
 * shared loads and one of JWK Sets, and the call to a service over HTTP with the reading of its answer: its JSON, its status
 * and its paging and retry headers. The checks of their arguments are in `@interopkit/core/checks`, and requests and answers
 * as plain data are in `@interopkit/core/http`.
 *
 * @module @interopkit/core
 */
export {
  type ReadAnswerJsonOptions,
  readAnswer,
  readAnswerJson,
  readStatusDetail,
  type StatusDetail,
} from "./answer.js";
export { findLinkTarget, hasNextLink, hasNextPage, readRetryAfterSeconds, readTotalCount } from "./answer-headers.js";
export type { CallOptions } from "./call-options.js";
export { callPort, type PortOutcome } from "./call-port.js";
export { type Clock, checkClock, readClock, SYSTEM_CLOCK } from "./clock.js";
export { DataError, InteropkitError, ServiceError, type ServiceErrorOptions } from "./errors.js";
export { createJwksCache, type JwksCache, type JwksCacheOptions } from "./jwks-cache.js";
export { createKeyedCache, type KeyedCache, type KeyedCacheOptions } from "./keyed-cache.js";
export { raceAbort } from "./race-abort.js";
export { type Random, SYSTEM_RANDOM } from "./random.js";
export {
  callService,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  type Fetch,
  type HttpMethod,
  type RequestOptions,
  requestService,
  type ServiceCall,
  type ServiceInit,
  type ServiceResponse,
} from "./service.js";
export { type CryptoKeySignerOptions, createCryptoKeySigner, type Signer, signCompactJws } from "./signer/index.js";
