/**
 * The foundation that the interopkit packages share: their errors, a clock, the options of a call that waits on I/O, and
 * the call to a service over HTTP. The checks of their arguments are in `@interopkit/core/checks`.
 *
 * @module @interopkit/core
 */
export type { CallOptions } from "./call-options.js";
export { type Clock, checkClock, readClock, SYSTEM_CLOCK } from "./clock.js";
export { DataError, InteropkitError, ServiceError } from "./errors.js";
export { callService, DEFAULT_TIMEOUT_MS, type Fetch, type ServiceCall } from "./service.js";
export { untilAborted } from "./until-aborted.js";
