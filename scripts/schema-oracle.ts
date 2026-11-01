import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Schema, Validator } from "@cfworker/json-schema";
import { requireSchemas } from "./schemas.ts";

/** The drafts of JSON Schema that the pinned schemas of the standards are written in. */
export type SchemaDraft = "7" | "2019-09";

/** A class of a schema: the names of its properties and the names of those that it requires. */
export interface SchemaClass {
  /** The names of the properties. */
  readonly properties: readonly string[];
  /** The names of the required properties. */
  readonly required: readonly string[];
}

/**
 * Reads a pinned JSON Schema, which `pnpm schemas` downloads.
 *
 * @param root - The repository.
 * @param file - The name of the file in the lock of the schemas.
 * @throws `Error` when the schemas are not downloaded or the file is not one of them.
 */
export function readSchema(root: string, file: string): Schema {
  return JSON.parse(readFileSync(join(requireSchemas(root), file), "utf8"));
}

/**
 * Returns a function that tells whether a value is valid by a schema, with `format` asserted as the schemas of the standards
 * intend.
 *
 * @remarks
 * The validator reads some formats more loosely than the standards: its `uuid` takes a `urn:uuid:` prefix, its `date-time`
 * takes a space and an offset without a colon. A reader that is stricter says so in its spec gaps.
 */
export function schemaValidator(schema: Schema, draft: SchemaDraft): (value: unknown) => boolean {
  const validator = new Validator(schema, draft);
  return (value) => validator.validate(value).valid;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the properties and the required properties of a definition, or of the root, of a schema. */
export function schemaClass(definition: unknown): SchemaClass {
  if (!isObject(definition)) throw new Error("The definition of a class is an object.");
  const { properties, required } = definition;
  return {
    properties: isObject(properties) ? Object.keys(properties) : [],
    required: Array.isArray(required) ? required.filter((name): name is string => typeof name === "string") : [],
  };
}

/** Reads the classes that a schema defines in `$defs` or `definitions`, by the name that the schema gives each. */
export function schemaDefinitions(schema: Schema): ReadonlyMap<string, SchemaClass> {
  const definitions = schema.$defs ?? schema.definitions ?? {};
  return new Map(Object.entries(definitions).map(([name, definition]) => [name, schemaClass(definition)]));
}
