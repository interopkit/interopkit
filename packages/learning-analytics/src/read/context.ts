import { jsonObjectSchema, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";
import { CALIPER_CONTEXT, type Context, LIBRARY_PROFILE_CONTEXT } from "../model/index.js";
import { iri } from "./primitives.js";

/** The contexts that may come last in the `@context` of a document: the one of Caliper 1.2 and the one of the Library Use Profile. */
const CALIPER_CONTEXTS: readonly string[] = [CALIPER_CONTEXT, LIBRARY_PROFILE_CONTEXT];

/** The context of a sender's own: the address of one, or the terms it defines inline (Caliper 1.2 section 4.1). */
const localContext = v.union([iri, jsonObjectSchema]);

const NOT_CALIPER = "expected the context of Caliper 1.2, or a list of contexts that ends with it";

/** Tells whether a context is one of Caliper. */
function isCaliperContext(context: string): boolean {
  return CALIPER_CONTEXTS.includes(context);
}

/**
 * The schema of the `@context` of an event or an entity document: the context of Caliper, a list of contexts that ends with
 * it, so that the terms of Caliper keep their meaning, or the terms of one context defined inline, as Figure 5 of Caliper 1.2
 * and one of its fixtures write them (section 4.1).
 */
export const contextSchema: Schema<Context> = v.union([
  v.pipe(iri, v.check(isCaliperContext, NOT_CALIPER)),
  jsonObjectSchema,
  v.pipe(
    v.array(localContext),
    v.nonEmpty(),
    v.check((list) => isCaliperContext(String(list.at(-1))), NOT_CALIPER),
  ),
]);

/**
 * The schema of the `@context` of an entity inside another entity or an event: any context, as the specification lets a
 * sender add one wherever it defines an object. Only the top-level context must end with a context of Caliper, because that is
 * the one that a processor reads first.
 */
export const nestedContextSchema: Schema<Context> = v.union([iri, jsonObjectSchema, v.array(localContext)]);
