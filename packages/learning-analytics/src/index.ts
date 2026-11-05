/**
 * Caliper Analytics 1.2: the model of its events and entities, readers of events and entities that arrive from elsewhere,
 * builders of events with identifiers that stay the same when an event is reported again, and a sensor that sends events to an
 * endpoint.
 *
 * It also exports the types of `@interopkit/core` that its declarations name, which a program that installs this
 * package imports from here.
 *
 * @module @interopkit/learning-analytics
 */

export type { CallOptions, Fetch } from "@interopkit/core";
export type { Issue, JsonObject } from "@interopkit/core/checks";
export type { HttpRequest, HttpResponse } from "@interopkit/core/http";
export { type BuildOptions, buildEntity, buildEvent, mintUrn } from "./build/index.js";
export * from "./model/index.js";
export { type ReadOptions, readEntity, readEvent } from "./read/index.js";
export {
  type CaliperSender,
  type PingResult,
  pingEndpoint,
  type SendCaliperOptions,
  sendCaliper,
} from "./send/index.js";
export { type ValidateOptions, validateEntity, validateEvent } from "./validate/index.js";
