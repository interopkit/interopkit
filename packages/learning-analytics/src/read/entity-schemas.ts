import { looseRecord, type Schema } from "@interopkit/core/checks";
import type { CaliperEntity, CaliperEvent, CaliperVersion, Context } from "../model/index.js";
import { assessmentSchemas } from "./assessment-schemas.js";
import { contextSchemaOf } from "./context.js";
import { createEventSchema, createEventSchemas } from "./event-schemas.js";
import { peopleSchemas } from "./people-schemas.js";
import { questionnaireSchemas } from "./questionnaire-schemas.js";
import { createEntitySchema, createRanges, type EntitySchemas } from "./range.js";
import { recordSchemas } from "./record-schemas.js";
import { resourceSchemas } from "./resource-schemas.js";

/** The schemas that read the documents of one version of Caliper. */
export interface SchemaSet {
  /** The schemas of the entities, by the term of their type. */
  readonly entities: EntitySchemas;
  /** The schemas of the events, by the term of their type. */
  readonly events: ReturnType<typeof createEventSchemas>;
  /** The schema of an entity written as an object, of any class, chosen by its `type`. */
  readonly entity: Schema<CaliperEntity>;
  /** The schema of an event, of any class, chosen by its `type`. */
  readonly event: Schema<CaliperEvent>;
  /** The schema of an entity describe as a whole, before its class is read: it has the `@context` of Caliper. */
  readonly entityDocument: Schema<{ readonly "@context": Context }>;
}

/** Makes the schemas of a version: every class of the model, read as that version defines it. */
function createSchemaSet(version: CaliperVersion): SchemaSet {
  const to = createRanges(() => entities, version);
  const entities = {
    ...peopleSchemas(to),
    ...resourceSchemas(to),
    ...assessmentSchemas(to),
    ...questionnaireSchemas(to),
    ...recordSchemas(to),
  } satisfies EntitySchemas;
  const events = createEventSchemas(to);
  return {
    entities,
    events,
    entity: createEntitySchema(() => entities, version),
    event: createEventSchema(() => events, version),
    entityDocument: looseRecord({ "@context": contextSchemaOf(version) }),
  };
}

/** The schemas of each version of Caliper that the readers know. */
export const SCHEMA_SETS: Readonly<Record<CaliperVersion, SchemaSet>> = {
  "1.2": createSchemaSet("1.2"),
  "1.1": createSchemaSet("1.1"),
};
