import { jsonObjectSchema, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";
import { CALIPER_CONTEXT, type Context, LIBRARY_PROFILE_CONTEXT } from "../model/index.js";
import { iri } from "./primitives.js";

/** The contexts that may come last in the `@context` of a document: the one of Caliper 1.2 and the one of the Library Use Profile. */
const CALIPER_CONTEXTS: readonly string[] = [CALIPER_CONTEXT, LIBRARY_PROFILE_CONTEXT];

/** The context of a sender's own: the address of one, or the terms it defines inline (Caliper 1.2 section 4.1). */
const localContext = v.union([iri, jsonObjectSchema]);

/**
 * The schema of the `@context` of an event or an entity document. One context must be a context of Caliper; a list must end with
 * one, so that the terms of Caliper keep their meaning (Caliper 1.2 section 4.1).
 */
export const contextSchema: Schema<Context> = v.pipe(
  v.union([iri, v.pipe(v.array(localContext), v.nonEmpty())]),
  v.check(
    (context) => CALIPER_CONTEXTS.includes(typeof context === "string" ? context : String(context.at(-1))),
    "expected the context of Caliper 1.2, or a list of contexts that ends with it",
  ),
);

/**
 * The schema of the `@context` of an entity inside another entity or an event: any context, as the specification lets a
 * sender add one wherever it defines an object. Only the top-level context must end with a context of Caliper, because that is
 * the one that a processor reads first.
 */
export const nestedContextSchema: Schema<Context> = v.union([iri, jsonObjectSchema, v.array(localContext)]);
