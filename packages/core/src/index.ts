/**
 * The foundation that the interopkit packages share: their errors, a clock, the options of a call that waits on I/O, and
 * the call to a service over HTTP. The checks of their arguments are in `@interopkit/core/checks`, and requests and answers
 * as plain data are in `@interopkit/core/http`.
 *
 * @module @interopkit/core
 */
export type { CallOptions } from "./call-options.js";
export { type Clock, checkClock, readClock, SYSTEM_CLOCK } from "./clock.js";
export { DataError, InteropkitError, ServiceError } from "./errors.js";
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
export { type CryptoKeySignerOptions, type Signer, signCompactJws, signerFromCryptoKey } from "./signer/index.js";
export { untilAborted } from "./until-aborted.js";
