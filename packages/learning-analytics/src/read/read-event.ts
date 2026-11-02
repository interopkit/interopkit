import { parseWith } from "@interopkit/core/checks";
import type { CaliperEvent } from "../model/index.js";
import { eventSchema } from "./event-schemas.js";
import { copyDocument } from "./json-copy.js";

/**
 * Reads an event into the model: checks its `@context`, its `type`, every property against the class of the event, the
 * actions and the classes of entities that its profile allows, and returns a copy.
 *
 * @remarks
 * Each entity inside the event may be an object or an IRI where the specification allows an entity, and an object is read by
 * its own class. A sender's own properties belong in `extensions`; any other property that the class does not have is refused.
 * The result shares nothing with the input. A value that is not JSON, or nests more than `MAX_JSON_DEPTH` levels, is refused
 * before it is read, and the first fault ends the reading. A text of JSON is bounded in size, depth and tokens before it is
 * parsed, by `readJson` of `@interopkit/core/http`.
 *
 * @param value - The event, such as the parsed text of a request.
 * @returns The event.
 * @throws `DataError` that names the path of the first property that is not valid, or where the value is not JSON.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 */
export function readEvent(value: unknown): CaliperEvent {
  return parseWith(eventSchema, copyDocument(value, "The event"), "The event");
}
