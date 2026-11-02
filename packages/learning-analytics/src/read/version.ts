import type { Schema } from "@interopkit/core/checks";
import * as v from "valibot";
import type { CaliperVersion } from "../model/index.js";
import { DEPRECATED_IN_1_1, NOT_IN_1_1, propertiesNotIn1p1, TERMS_NOT_IN_1_1 } from "../v1p1/index.js";

/** The classes that a version does not define, by their term. Caliper 1.2 defines every class of the model. */
const NOT_DEFINED: Readonly<Record<CaliperVersion, ReadonlySet<string>>> = {
  "1.2": new Set(),
  "1.1": new Set([...NOT_IN_1_1.events, ...NOT_IN_1_1.entities]),
};

/** Tells whether a version of Caliper defines a class of the model, an event or an entity. */
export function definesClass(version: CaliperVersion, type: string): boolean {
  return !NOT_DEFINED[version].has(type);
}

/**
 * Words what a class that a version leaves out is, for a message: the class that Caliper 1.1 deprecated says so, and any other is
 * left to the sentence that names the classes that are expected.
 */
export function retiredNote(version: CaliperVersion, type: string): string {
  const deprecated: readonly string[] = [...DEPRECATED_IN_1_1.events, ...DEPRECATED_IN_1_1.entities];
  return version === "1.1" && deprecated.includes(type)
    ? `, which Caliper 1.1 deprecated and the reader does not take`
    : "";
}

/** Why a version of Caliper refuses a class: the sentence, and where in the class the fault is. */
interface Refusal {
  readonly message: string;
  readonly path: [v.IssuePathItem, ...v.IssuePathItem[]];
}

/** Finds the first property of a class that Caliper 1.2 added and Caliper 1.1 does not define. */
function addedProperty(value: Readonly<Record<string, unknown>>, absent: readonly string[]): Refusal | undefined {
  const name = absent.find((property) => Object.hasOwn(value, property));
  if (name === undefined) return undefined;
  return {
    message: `Caliper 1.1 does not define the property ${name}, which Caliper 1.2 added`,
    path: [{ type: "object", origin: "value", input: value, key: name, value: value[name] }],
  };
}

/** Finds the first action or role of a class that Caliper 1.2 added and Caliper 1.1 does not define. */
function addedTerm(value: Readonly<Record<string, unknown>>): Refusal | undefined {
  for (const { property, what, terms } of TERMS_NOT_IN_1_1) {
    const found = value[property];
    const list: readonly unknown[] = Array.isArray(found) ? found : [found];
    const isAdded = (term: unknown): boolean => terms.some((added) => added === term);
    const at = list.findIndex(isAdded);
    if (at < 0) continue;
    const item = { type: "object", origin: "value", input: value, key: property, value: found } as const;
    return {
      message: `expected ${what} of Caliper 1.1, found ${JSON.stringify(list[at])}, which Caliper 1.2 added`,
      path: Array.isArray(found)
        ? [item, { type: "array", origin: "value", input: found, key: at, value: list[at] }]
        : [item],
    };
  }
  return undefined;
}

/**
 * Makes the schema of a class for a version of Caliper: the schema of the model, with the properties, the actions and the roles
 * that the version does not define refused. The schemas of the model are those of Caliper 1.2, so for 1.2 it returns the schema
 * itself.
 *
 * @remarks
 * The refusal follows the shape, so that a document with a wrong value reports that first. It is an issue of the property, and
 * reads as one that the schema refuses.
 *
 * @param version - The version of Caliper that governs the document.
 * @param type - The term of the class.
 * @param schema - The schema of the class in the model.
 */
export function restrictToVersion<TSchema extends Schema<Record<string, unknown>>>(
  version: CaliperVersion,
  type: string,
  schema: TSchema,
): Schema<v.InferOutput<TSchema>> {
  if (version === "1.2") return schema;
  const absent = propertiesNotIn1p1(type);
  return v.pipe(
    schema,
    v.rawTransform(({ dataset, addIssue, NEVER }) => {
      const { value } = dataset;
      const refusal = addedProperty(value, absent) ?? addedTerm(value);
      if (refusal === undefined) return value;
      addIssue(refusal);
      return NEVER;
    }),
  );
}
