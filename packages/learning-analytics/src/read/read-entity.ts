import { parseWith } from "@interopkit/core/checks";
import type { EntityDocument } from "../model/index.js";
import { entityDocumentSchema, entitySchema } from "./entity-schemas.js";
import { copyDocument } from "./json-copy.js";

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
 * @param value - The entity describe, such as the parsed text of a request.
 * @returns The entity, with its `@context` first.
 * @throws `DataError` that names the path of the first property that is not valid, or where the value is not JSON.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}
 */
export function readEntity(value: unknown): EntityDocument {
  const { "@context": context, ...entity } = parseWith(
    entityDocumentSchema,
    copyDocument(value, "The entity"),
    "The entity",
  );
  return { "@context": context, ...parseWith(entitySchema, entity, "The entity") };
}
