import type { Context } from "./context.js";
import type { CaliperEntity } from "./entities/index.js";

/**
 * An entity with its `@context`: what a sensor sends as an entity describe, outside an event (Caliper 1.2 section 5.2). An entity
 * inside an event or another entity has no `@context` of its own.
 */
export type EntityDocument = CaliperEntity & {
  /** The context of the document: the Caliper context, or a list that ends with it. */
  readonly "@context": Context;
};
