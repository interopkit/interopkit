import { looseRecord } from "@interopkit/core/checks";
import { assessmentSchemas } from "./assessment-schemas.js";
import { contextSchema } from "./context.js";
import { peopleSchemas } from "./people-schemas.js";
import { questionnaireSchemas } from "./questionnaire-schemas.js";
import { createEntitySchema, createRanges, type EntitySchemas } from "./range.js";
import { recordSchemas } from "./record-schemas.js";
import { resourceSchemas } from "./resource-schemas.js";

/** Makes the schema of a range of entities, which events use as the entities do. */
export const to = createRanges(() => ENTITY_SCHEMAS);

/** The schemas of the entities, by the term of their type. */
export const ENTITY_SCHEMAS = {
  ...peopleSchemas(to),
  ...resourceSchemas(to),
  ...assessmentSchemas(to),
  ...questionnaireSchemas(to),
  ...recordSchemas(to),
} satisfies EntitySchemas;

/** The schema of an entity written as an object, of any class, chosen by its `type`. */
export const entitySchema = createEntitySchema(() => ENTITY_SCHEMAS);

/** The schema of an entity describe as a whole, before its class is read: it has the `@context` of Caliper. */
export const entityDocumentSchema = looseRecord({ "@context": contextSchema });
