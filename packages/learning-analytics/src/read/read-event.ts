import { parseWith } from "@interopkit/core/checks";
import type { CaliperEvent } from "../model/index.js";
import { SCHEMA_SETS } from "./entity-schemas.js";
import { copyDocument } from "./json-copy.js";
import { type ReadOptions, versionOf } from "./read-options.js";

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
 * With `version: "1.1"` the event is read as Caliper 1.1 defines it, into the same model: its `@context` is that of 1.1 or of one
 * of its extension profiles, and a class, property or action that 1.1 deprecated or only 1.2 defines is refused.
 *
 * @param value - The event, such as the parsed text of a request.
 * @param options - The version of Caliper that governs the event.
 * @returns The event.
 * @throws `DataError` that names the path of the first property that is not valid, or where the value is not JSON, or when the
 * options are not an object whose `version` is a version of Caliper that the readers know.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 * @see {@link https://www.imsglobal.org/sites/default/files/caliper/v1p1/caliper-spec-v1p1/caliper-spec-v1p1.html | Caliper Analytics 1.1}
 */
export function readEvent(value: unknown, options?: ReadOptions): CaliperEvent {
  const { event } = SCHEMA_SETS[versionOf(options, "The read options")];
  return parseWith(event, copyDocument(value, "The event"), "The event");
}
