import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Schema, Validator } from "@cfworker/json-schema";
import { requireSchemas } from "./schemas.ts";

/** The drafts of JSON Schema that the pinned schemas of the standards are written in. */
export type SchemaDraft = "4" | "7" | "2019-09";

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

/** The address that the files of a set of schemas take as their base, so that their `$ref` by `id` resolve to one another. */
const SET_BASE = "https://schemas.invalid/set/";

/**
 * Rewrites a draft 4 schema whose `id` is a bare name and whose `$ref` name other files, so that a validator resolves them:
 * the `id` becomes a `$id` below a base address, and every `$ref` is resolved against that address. The `schema` property, which
 * a draft 4 file of 1EdTech uses where draft 4 has `$schema`, is dropped.
 */
function qualify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(qualify);
  if (typeof node !== "object" || node === null) return node;
  return Object.fromEntries(
    Object.entries(node).flatMap(([key, value]): [string, unknown][] => {
      if (key === "schema") return [];
      if (key === "id" && typeof value === "string") return [["$id", SET_BASE + value]];
      if (key === "$ref" && typeof value === "string") return [[key, SET_BASE + value]];
      return [[key, qualify(value)]];
    }),
  );
}

/** A directory of draft 4 schemas that `$ref` each other by `id`, read by the name of the file without `.json`. */
export type SchemaSet = ReadonlyMap<string, Schema>;

/**
 * Reads the schemas of a directory that refer to one another by `id`, as the files of 1EdTech do.
 *
 * @param directory - The directory of the files.
 * @returns The schemas by name, qualified so that `schemaSetValidator` resolves their references.
 */
export function readSchemaSet(directory: string): SchemaSet {
  return new Map(
    readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .map((file): [string, Schema] => [
        file.slice(0, -".json".length),
        qualify(JSON.parse(readFileSync(`${directory}/${file}`, "utf8"))) as Schema,
      ]),
  );
}

/**
 * Returns a function that tells whether a value is valid by one schema of a set, with the others available to its references.
 *
 * @param set - The schemas, from `readSchemaSet`.
 * @param name - The name of the schema to validate by.
 * @param draft - The draft that the files are written in.
 * @throws `Error` when the set has no schema of that name.
 */
export function schemaSetValidator(set: SchemaSet, name: string, draft: SchemaDraft): (value: unknown) => boolean {
  const schema = set.get(name);
  if (schema === undefined) throw new Error(`The set of schemas has no schema ${name}.`);
  const validator = new Validator(schema, draft);
  for (const [other, file] of set) if (other !== name) validator.addSchema(file, SET_BASE + other);
  return (value) => validator.validate(value).valid;
}
