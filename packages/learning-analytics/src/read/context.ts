import { jsonObjectSchema, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";
import {
  CALIPER_1_1_CONTEXT,
  CALIPER_CONTEXT,
  type CaliperVersion,
  type Context,
  LIBRARY_PROFILE_CONTEXT,
} from "../model/index.js";
import { EXTENSION_CONTEXTS_1_1 } from "../v1p1/index.js";
import { iri } from "./primitives.js";

/**
 * The contexts that may come last in the `@context` of a document of each version: the one of Caliper and the one of its
 * extension profiles, which are the Library Use Profile for 1.2 and the six profiles that extend 1.1.
 */
const CALIPER_CONTEXTS: Readonly<Record<CaliperVersion, readonly string[]>> = {
  "1.2": [CALIPER_CONTEXT, LIBRARY_PROFILE_CONTEXT],
  "1.1": [CALIPER_1_1_CONTEXT, ...EXTENSION_CONTEXTS_1_1],
};

/** The context of a sender's own: the address of one, or the terms it defines inline (Caliper 1.2 section 4.1). */
const localContext = v.union([iri, jsonObjectSchema]);

/**
 * The schema of the `@context` of an event or an entity document of a version: the context of Caliper, a list of contexts that
 * ends with it, so that the terms of Caliper keep their meaning, or the terms of one context defined inline, as Figure 5 of
 * Caliper 1.2 and one of its fixtures write them (section 4.1).
 */
function createContextSchema(version: CaliperVersion): Schema<Context> {
  const contexts = CALIPER_CONTEXTS[version];
  const expected = `expected the context of Caliper ${version}, or a list of contexts that ends with it`;
  const isCaliperContext = (context: string): boolean => contexts.includes(context);
  return v.union([
    v.pipe(iri, v.check(isCaliperContext, expected)),
    jsonObjectSchema,
    v.pipe(
      v.array(localContext),
      v.nonEmpty(),
      v.check((list) => isCaliperContext(String(list.at(-1))), expected),
    ),
  ]);
}

const CONTEXT_SCHEMAS: Readonly<Record<CaliperVersion, Schema<Context>>> = {
  "1.2": createContextSchema("1.2"),
  "1.1": createContextSchema("1.1"),
};

/** Returns the schema of the `@context` of an event or an entity document of a version of Caliper. */
export function contextSchemaOf(version: CaliperVersion): Schema<Context> {
  return CONTEXT_SCHEMAS[version];
}

/**
 * The schema of the `@context` of an entity inside another entity or an event: any context, as the specification lets a
 * sender add one wherever it defines an object. Only the top-level context must end with a context of Caliper, because that is
 * the one that a processor reads first.
 */
export const nestedContextSchema: Schema<Context> = v.union([iri, jsonObjectSchema, v.array(localContext)]);
