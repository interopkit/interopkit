import { parseWith } from "@interopkit/core/checks";
import * as v from "valibot";
import {
  ACTIONS,
  CALIPER_CONTEXT,
  type CaliperAction,
  type CaliperEntity,
  type CaliperEvent,
  type CaliperEventType,
  type CaliperProfile,
  EVENT_TYPES,
  PROFILES,
} from "../model/index.js";
import { entitySchema, iri, time } from "../read/internal.js";

/** What one event says: the properties that Caliper 1.2 section 2.1 requires, and the entity that the action made. */
export interface EventInput {
  /** A UUID URN, from `mintUrn`. */
  readonly id: string;
  /** The term of the event's type. */
  readonly type: CaliperEventType;
  /** The profile that governs the event. */
  readonly profile: CaliperProfile;
  /** The agent who acted. */
  readonly actor: CaliperEntity;
  /** What the actor did. */
  readonly action: CaliperAction;
  /** What the actor acted on. */
  readonly object: CaliperEntity;
  /**
   * What the action made.
   *
   * @defaultValue none
   */
  readonly generated?: CaliperEntity;
  /** When it happened, in the form of `caliperTime`. */
  readonly eventTime: string;
  /** The IRI of the application that the event happened in. */
  readonly edApp: string;
}

const urnSchema = v.pipe(
  v.string(),
  v.regex(
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
    (issue) => `expected a UUID URN, \`urn:uuid:\` and a UUID, found ${issue.received}`,
  ),
);

const eventInputSchema = v.strictObject({
  id: urnSchema,
  type: v.picklist(EVENT_TYPES),
  profile: v.picklist(PROFILES),
  actor: entitySchema,
  action: v.picklist(ACTIONS),
  object: entitySchema,
  generated: v.optional(entitySchema),
  eventTime: time,
  edApp: iri,
});

/**
 * Builds a Caliper event: writes the `@context` and checks every property.
 *
 * @remarks
 * The identifier is the caller's, so that reporting the same thing again gives the same identifier: make it with
 * `mintUrn` from what identifies the event. The result shares nothing with the input, and its properties are in a fixed
 * order, so the same event always serializes to the same bytes.
 *
 * @param input - What the event says.
 * @returns The event.
 * @throws `DataError` that names the path of the first property that is not valid, such as an entity whose `id` is not an
 * absolute IRI, or one that has a property that this version does not build.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 */
export function buildEvent(input: EventInput): CaliperEvent {
  const { id, type, profile, actor, action, object, generated, eventTime, edApp } = parseWith(
    eventInputSchema,
    input,
    "The event",
  );
  return {
    "@context": CALIPER_CONTEXT,
    id,
    type,
    profile,
    actor,
    action,
    object,
    ...(generated === undefined ? {} : { generated }),
    eventTime,
    edApp,
  };
}
