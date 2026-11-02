/**
 * Caliper Analytics 1.2: the model of its events and entities, events with identifiers that stay the same when an event is
 * reported again, readers of entities that arrive from elsewhere, and a sensor that sends events to an endpoint.
 *
 * @module @interopkit/learning-analytics
 */
export { buildEvent, caliperTime, checkIri, type EventInput, mintUrn } from "./build/index.js";
export * from "./model/index.js";
export { readEntity } from "./read/index.js";
export { type CaliperSender, DEFAULT_CALIPER_TIMEOUT_MS, type SendCaliperOptions, sendCaliper } from "./send/index.js";
