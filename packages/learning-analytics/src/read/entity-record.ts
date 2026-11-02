import { jsonObjectSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { nestedContextSchema } from "./context.js";
import { iri, text, time } from "./primitives.js";
import type { RangeFactory } from "./range.js";

/**
 * Makes the entries that every entity has beyond its `id` and `type` (Caliper 1.2 section 2.2): the schemas of the properties
 * of the generic entity. A class adds its own properties to them.
 *
 * @param to - Makes the schema of a range of entities.
 */
export function entityEntries(to: RangeFactory) {
  return {
    "@context": v.optional(nestedContextSchema),
    name: v.optional(text),
    description: v.optional(text),
    dateCreated: v.optional(time),
    dateModified: v.optional(time),
    otherIdentifiers: v.optional(v.array(to(["SystemIdentifier"]))),
    extensions: v.optional(jsonObjectSchema),
  };
}

/**
 * Makes the schema of a class of entities with an `id`: the `id` and the `type`, which only the term of the class satisfies,
 * and the entries of the class. A property the entries do not name is refused: the model asks for a sender's own properties to
 * go in `extensions`.
 *
 * @param type - The term of the class.
 * @param entries - The schemas of the properties of the class and of its supertypes.
 */
export function entityRecord<const TType extends string, const TEntries extends v.ObjectEntries>(
  type: TType,
  entries: TEntries,
) {
  return strictRecord({ id: iri, type: v.literal(type), ...entries });
}
