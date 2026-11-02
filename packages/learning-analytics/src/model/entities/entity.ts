import type { JsonObject } from "@interopkit/core/checks";
import type { Context } from "../internal.js";
import type { SystemIdentifier } from "./identifier.js";

/**
 * An entity written as an object, or as the IRI that names it (Caliper 1.2 section 2.2). A sender that expects the receiver to
 * look the entity up writes the IRI.
 */
export type Ref<TEntity> = TEntity | string;

/**
 * The generic entity, and the base of every other: it holds the properties that all entities share (Caliper 1.2 section 2.2).
 * A sender uses the generic type only when no subtype describes the thing.
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface Entity<TType extends string = "Entity"> {
  /** The context of the sender's own terms, which an entity may carry wherever it is defined. */
  readonly "@context"?: Context;
  /** The IRI that names the entity, or a blank node identifier that is meaningful only inside its document. */
  readonly id: string;
  /** The term of the entity's type. */
  readonly type: TType;
  /** The word or phrase by which the entity is known. */
  readonly name?: string;
  /** A short written description of the entity. */
  readonly description?: string;
  /** When the entity was created, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly dateCreated?: string;
  /** When the entity last changed, in the same form. */
  readonly dateModified?: string;
  /** The other identifiers that the sensor knows for the entity, such as an email address or an LTI user id. */
  readonly otherIdentifiers?: readonly Ref<SystemIdentifier>[];
  /** Attributes of the sender's own that the model does not describe. */
  readonly extensions?: JsonObject;
}
