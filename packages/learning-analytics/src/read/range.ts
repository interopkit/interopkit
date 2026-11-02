import { describe, isRecord, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";
import { type CaliperEntity, type CaliperEntityType, ENTITY_TYPES, type EntityOf, type Ref } from "../model/index.js";
import { iri } from "./primitives.js";

/** The schemas of the entities, by the term of their type. */
export type EntitySchemas = { readonly [TType in CaliperEntityType]: Schema<EntityOf<TType>> };

/** Makes the schema of a value that is an entity of the given types, or the IRI of one. */
export type RangeFactory = <const TRange extends readonly CaliperEntityType[]>(
  range: TRange,
) => Schema<Ref<EntityOf<TRange[number]>>>;

/** Words a value for a message: an object by its type. */
function foundOf(input: unknown): string {
  if (!isRecord(input)) return describe(input);
  return typeof input.type === "string" ? `an entity of type ${input.type}` : "an object without a type";
}

/** Words the types of a range for a message: `A`, `A or B`, `A, B or C`. */
function namesOf(range: readonly string[]): string {
  return range.length === 1 ? (range[0] ?? "") : `${range.slice(0, -1).join(", ")} or ${range.at(-1)}`;
}

/** Makes the function that finds the schema of an object of a range by its `type`, and finds none for another value. */
function finderOf<const TRange extends readonly CaliperEntityType[]>(range: TRange, schemas: () => EntitySchemas) {
  const members: ReadonlySet<string> = new Set(range);
  const isMember = (type: unknown): type is TRange[number] => typeof type === "string" && members.has(type);
  return (input: unknown): Schema<EntityOf<TRange[number]>> | undefined =>
    isRecord(input) && isMember(input.type) ? schemas()[input.type] : undefined;
}

/**
 * Makes the function that builds the schema of a range from the schemas of all entities, which it reads only when a value is
 * read, so that entities can name one another.
 *
 * @remarks
 * A string is read as the IRI of an entity. An object is read by the schema of its `type`, when the type is in the range: so the
 * schema of a range costs one lookup, and a value is checked once, whatever the size of the range.
 *
 * @param schemas - Returns the schemas of all entities.
 */
export function createRanges(schemas: () => EntitySchemas): RangeFactory {
  return <const TRange extends readonly CaliperEntityType[]>(range: TRange) => {
    const find = finderOf(range, schemas);
    const names = namesOf(range);
    return v.lazy((input): Schema<Ref<EntityOf<TRange[number]>>> => {
      if (typeof input === "string") return iri;
      return find(input) ?? v.never(`expected an entity of type ${names}, or its IRI, found ${foundOf(input)}`);
    });
  };
}

/**
 * Makes the schema of an entity written as an object of any class, chosen by its `type`.
 *
 * @param schemas - Returns the schemas of all entities.
 */
export function createEntitySchema(schemas: () => EntitySchemas): Schema<CaliperEntity> {
  const find = finderOf(ENTITY_TYPES, schemas);
  return v.lazy((input) => find(input) ?? v.never(`expected an entity of any class, found ${foundOf(input)}`));
}
