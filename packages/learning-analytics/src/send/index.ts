/**
 * The sensor: sends events and entity describes to a Caliper endpoint in one envelope, and asks the endpoint for its
 * configuration.
 *
 * @module
 */
export { type PingResult, pingEndpoint } from "./ping-endpoint.js";
export { type SendCaliperOptions, sendCaliper } from "./send-caliper.js";
export { type CaliperSender, DEFAULT_CALIPER_TIMEOUT_MS } from "./sender.js";
