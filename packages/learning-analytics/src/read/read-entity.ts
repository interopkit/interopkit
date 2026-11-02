import { parseWith } from "@interopkit/core/checks";
import type { EntityDocument } from "../model/index.js";
import { SCHEMA_SETS } from "./entity-schemas.js";
import { copyDocument } from "./json-copy.js";
import { type ReadOptions, versionOf } from "./read-options.js";

/**
 * Reads an entity describe into the model: checks that it names a context of Caliper, that its `type` is a class of Caliper, and
 * that every property is one of that class, with a value of the right form, and returns a copy.
 *
 * @remarks
 * The entities inside it are checked by their own classes: each may be an object or an IRI where the specification allows an
 * entity. A sender's own properties belong in `extensions`; any other property that the class does not have is refused. The
 * result shares nothing with the input, and a value that is not JSON, or nests more than `MAX_JSON_DEPTH` levels, is refused
 * before it is read. A text of JSON is bounded in size, depth and tokens before it is parsed, by `readJson` of
 * `@interopkit/core/http`.
 *
 * With `version: "1.1"` the entity is read as Caliper 1.1 defines it, into the same model: its `@context` is that of 1.1 or of one
 * of its extension profiles, and a class or property that 1.1 deprecated or only 1.2 defines is refused.
 *
 * @param value - The entity describe, such as the parsed text of a request.
 * @param options - The version of Caliper that governs the entity.
 * @returns The entity, with its `@context` first.
 * @throws `DataError` that names the path of the first property that is not valid, or where the value is not JSON, or when the
 * options are not an object whose `version` is a version of Caliper that the readers know.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 * @see {@link https://www.imsglobal.org/sites/default/files/caliper/v1p1/caliper-spec-v1p1/caliper-spec-v1p1.html | Caliper Analytics 1.1}
 */
export function readEntity(value: unknown, options?: ReadOptions): EntityDocument {
  const { entity: entitySchema, entityDocument } = SCHEMA_SETS[versionOf(options, "The read options")];
  const { "@context": context, ...entity } = parseWith(entityDocument, copyDocument(value, "The entity"), "The entity");
  return { "@context": context, ...parseWith(entitySchema, entity, "The entity") };
}
