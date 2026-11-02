import { DataError } from "@interopkit/core";
import {
  isRecord,
  type JsonObject,
  jsonObjectSchema,
  parseWith,
  refusalOf,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import {
  CALIPER_CONTEXT,
  type CaliperEntity,
  type CaliperEvent,
  type Context,
  type EntityDocument,
  type EventInput,
  LIBRARY_PROFILE_CONTEXT,
} from "../model/index.js";
import { LIBRARY_ENTITY_TYPES, LIBRARY_EVENT_TYPES } from "../model/internal.js";
import { iri, readEntity, readEvent } from "../read/internal.js";
import { eventFindings } from "../validate/internal.js";

/** What `buildEvent` and `buildEntity` take beside the document. */
export interface BuildOptions {
  /**
   * The contexts of the sender's own that are written before the context of Caliper, each the address of a context or the
   * terms of one defined inline.
   *
   * @defaultValue none
   */
  readonly contexts?: readonly (string | JsonObject)[];
}

const buildOptionsSchema = strictRecord({
  contexts: v.optional(v.array(v.union([iri, jsonObjectSchema]))),
});

/**
 * Writes the `@context` of a document: the context of Caliper, or of the Library Use Profile for the terms that profile
 * defines, after the contexts of the sender.
 */
function contextOf(
  document: unknown,
  libraryTypes: readonly string[],
  options: BuildOptions | undefined,
  label: string,
): Context {
  const { contexts = [] } = parseWith(buildOptionsSchema, options === undefined ? {} : options, "The options");
  if (isRecord(document) && "@context" in document) {
    throw new DataError(
      `${label} is invalid at ["@context"]: the builder writes the context, so give the contexts of your own in the option contexts.`,
    );
  }
  const type = isRecord(document) ? document.type : undefined;
  const caliper = libraryTypes.some((term) => term === type) ? LIBRARY_PROFILE_CONTEXT : CALIPER_CONTEXT;
  return contexts.length === 0 ? caliper : [...contexts, caliper];
}

/**
 * Builds a Caliper event: writes the `@context`, checks every property as `readEvent` does, and checks the rules of its profile.
 *
 * @remarks
 * The identifier is the caller's, so that reporting the same thing again gives the same identifier: make it with `mintUrn` from
 * what identifies the event. The result shares nothing with the input, and its properties are in a fixed order, so the same
 * event always serializes to the same bytes. The context is that of Caliper, or that of the Library Use Profile for its events,
 * after the contexts in the options. The errors of `validateEvent` refuse the event, such as an action that its profile does not
 * have or a media location without a `currentTime`; its warnings do not.
 *
 * @param input - What the event says: the properties of its class, without `@context`.
 * @param options - The contexts of the sender's own.
 * @returns The event.
 * @throws `DataError` that names the path of the first property that is not valid, such as an entity whose `id` is not an
 * absolute IRI, an action that the event does not allow, a profile that does not have the event, or an input that has an
 * `@context`, and counts the other errors.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 */
export function buildEvent(input: EventInput, options?: BuildOptions): CaliperEvent {
  const context = contextOf(input, LIBRARY_EVENT_TYPES, options, "The event");
  const event = readEvent(isRecord(input) ? { "@context": context, ...input } : input);
  const errors = [...eventFindings(event)].filter(({ severity }) => severity === "error");
  if (errors.length > 0) throw new DataError(refusalOf("The event", errors, "validateEvent"));
  return event;
}

/**
 * Builds an entity describe: writes the `@context` and checks every property, as `readEntity` does.
 *
 * @remarks
 * The result shares nothing with the input, and its properties are in a fixed order. The context is that of Caliper, or that of
 * the Library Use Profile for its entities, after the contexts in the options.
 *
 * @param input - What the entity says: the properties of its class, without `@context`.
 * @param options - The contexts of the sender's own.
 * @returns The entity, with its `@context` first.
 * @throws `DataError` that names the path of the first property that is not valid, or an input that has an `@context`.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 */
export function buildEntity(input: CaliperEntity, options?: BuildOptions): EntityDocument {
  const context = contextOf(input, LIBRARY_ENTITY_TYPES, options, "The entity");
  return readEntity(isRecord(input) ? { "@context": context, ...input } : input);
}
