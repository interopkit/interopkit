/**
 * The endpoint: receives the envelopes that sensors send, and answers their requests for its configuration.
 *
 * @module
 */

export { readEnvelope } from "./envelope.js";
export { handleCaliperRequest } from "./handle-request.js";
export type { CaliperEndpointOptions } from "./options.js";
export type { ReceivedEnvelope } from "./received-envelope.js";
