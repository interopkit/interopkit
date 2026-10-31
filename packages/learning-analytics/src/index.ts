/**
 * Caliper Analytics 1.2 events and a sensor: events with identifiers that stay the same when an event is reported again,
 * and the call that sends them to an endpoint in one envelope.
 *
 * @module @interopkit/learning-analytics
 */
export { buildEvent, caliperTime, checkIri, type EventInput, mintUrn } from "./build/index.js";
export {
  CALIPER_CONTEXT,
  type CaliperAction,
  type CaliperEntity,
  type CaliperEvent,
  type CaliperEventType,
  type CaliperProfile,
} from "./model/index.js";
export { type CaliperSender, DEFAULT_CALIPER_TIMEOUT_MS, type SendCaliperOptions, sendCaliper } from "./send/index.js";
