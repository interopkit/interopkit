import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fc from "fast-check";
import {
  type CaliperTables,
  type ClassTable,
  type PropertyRow,
  readCaliperTables,
} from "../../../scripts/caliper-tables.js";
import { schemaArbitrary } from "../../../scripts/schema-arbitrary.js";
import { readSchemaSet, type SchemaSet, schemaSetValidator } from "../../../scripts/schema-oracle.js";

/** The repository, whose `.cache/` holds the downloads that these helpers read. */
export const ROOT = resolve(import.meta.dirname, "../../..");

/** The pinned tables of Caliper 1.2 and of the Library Use Profile, which `pnpm caliper-tables` downloads. */
export const TABLES: CaliperTables = readCaliperTables(ROOT, "caliper-1p2.json");
export const LIBRARY_TABLES: CaliperTables = readCaliperTables(ROOT, "caliper-library-1p2.json");

/** The `caliper-spec` repository at the pinned commit, which `pnpm corpus` downloads. */
const CALIPER_SPEC = join(ROOT, ".cache/corpus/caliper-spec");

/** Every event and entity of the tables, by term. */
export const CLASSES: ReadonlyMap<string, ClassTable> = new Map(
  [...TABLES.entities, ...LIBRARY_TABLES.entities, ...TABLES.events, ...LIBRARY_TABLES.events].map((table) => [
    table.term,
    table,
  ]),
);

/** The terms of the entities that have an `id`: every entity but the two that Appendix C defines without one. */
export const ENTITY_TERMS: readonly string[] = [...TABLES.entities, ...LIBRARY_TABLES.entities]
  .map((table) => table.term)
  .filter((term) => term !== "TextPositionSelector" && term !== "SystemIdentifier");

/** The properties that a class has by the tables: its own, those of its supertypes, and those of the base class. */
export function inheritedRows(term: string, base: readonly PropertyRow[]): ReadonlyMap<string, PropertyRow> {
  const rows = new Map<string, PropertyRow>(base.map((row) => [row.name, row]));
  const visit = (name: string): void => {
    const table = CLASSES.get(name);
    for (const supertype of table?.supertypes ?? []) visit(supertype);
    for (const row of table?.properties ?? []) rows.set(row.name, row);
  };
  visit(term);
  return rows;
}

/** The terms of a class and of every class below it. */
export function closure(term: string): string[] {
  const below = (name: string): boolean =>
    name === term || (CLASSES.get(name)?.supertypes ?? []).some((supertype) => below(supertype));
  return [...CLASSES.keys()].filter(below);
}

/** The schemas of Caliper 1.2, which `pnpm corpus` downloads, each qualified so that they refer to one another. */
export const SCHEMA_1_2: SchemaSet = readSchemaSet(join(CALIPER_SPEC, "json_schema/schema_1_2"));

/** Tells whether the draft 4 schema of the class accepts a value. */
export function schemaAccepts(term: string): (value: unknown) => boolean {
  return schemaSetValidator(SCHEMA_1_2, term, "4");
}

/** The fixtures of Caliper 1.2: the files that begin with `prefix`, parsed, by file name. */
export function fixtures(prefix: string, negative = false): ReadonlyMap<string, string> {
  const directory = join(CALIPER_SPEC, "fixtures/v1p2", negative ? "commonErrorFixtures" : "");
  return new Map(
    readdirSync(directory)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .map((name) => [name, readFileSync(join(directory, name), "utf8")]),
  );
}

/** What the schemas and the tables each say that the other does not, for the generated values: see the guide `spec-gaps.md`. */
const BASE = "#/$defs/";
const IRI_FORMAT = "iri";
const DROPPED_KEYWORDS = new Set([
  "maxLength",
  "$id",
  "definedBy",
  "metaFormat",
  "translations",
  "title",
  "description",
]);

/** Rewrites a qualified schema of the set for `schemaArbitrary`: references to `#/$defs/`, and keywords it does not read dropped. */
function localize(node: unknown, base: string): unknown {
  if (Array.isArray(node)) return node.map((member) => localize(member, base));
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(key)) continue;
    if (key === "$ref" && typeof value === "string") out[key] = BASE + value.slice(base.length).replace("#/", "/");
    else if (key === "type" && Array.isArray(value)) out[key] = "object";
    else out[key] = localize(value, base);
  }
  return out;
}

/** The names of the classes that a property of a schema refers to, in any branch. */
function refsOf(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(refsOf);
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === "$ref" && typeof value === "string" ? [value.slice(BASE.length)] : refsOf(value),
  );
}

/** The range of a property by the tables: the IRI, or an object of one of the classes below the named ones. */
function rangeOf(types: readonly string[], schemaProperty?: unknown): unknown {
  const inSchema = schemaProperty === undefined ? [] : refsOf(schemaProperty);
  const terms = [...new Set(types.flatMap((term) => closure(term)))].filter(
    (term) => ENTITY_TERMS.includes(term) && SCHEMA_1_2.has(term) && (inSchema.length === 0 || inSchema.includes(term)),
  );
  return { anyOf: [{ type: "string", format: IRI_FORMAT }, ...terms.map((term) => ({ $ref: BASE + term }))] };
}

/** The part of a table row's type that names classes of entities with an `id`; `Entity` names all of them. */
function entityTypes(row: PropertyRow): string[] {
  return row.types.filter((type) => type === "Entity" || ENTITY_TERMS.includes(type));
}

/**
 * Builds the definitions that `schemaArbitrary` generates entities from: the classes of `schema_1_2`, narrowed to what the tables
 * allow. A property that the schema has and the table lacks is dropped, an entity range is the classes the table names, a list
 * has the members its description names, and a count is an integer. What each narrowing removes is a difference that
 * `spec-gaps.md` records.
 */
export function narrowedDefinitions(): Record<string, unknown> {
  const definitions: Record<string, unknown> = {};
  const base = "https://schemas.invalid/set/";
  for (const [name, schema] of SCHEMA_1_2) definitions[name] = localize(schema, base);
  for (const term of ENTITY_TERMS.filter((name) => SCHEMA_1_2.has(name))) {
    const rows = inheritedRows(term, TABLES.entityProperties);
    const original = definitions[term] as { properties?: Record<string, unknown> };
    const properties: Record<string, unknown> = {};
    // A property that the table requires and the schema does not define is generated too, from the table alone.
    const names = new Set([
      ...Object.keys(original.properties ?? {}),
      ...[...rows.values()].filter((row) => row.disposition === "Required").map((row) => row.name),
    ]);
    for (const name of names) {
      const property = original.properties?.[name];
      const row = rows.get(name);
      if (row === undefined && !["@context", "id", "type", "extensions"].includes(name)) continue;
      const entities = row === undefined ? [] : entityTypes(row);
      const isList = row?.types.some((type) => type.toLowerCase() === "array") === true;
      if (isList && row?.collectionOf !== undefined) {
        properties[name] = { type: "array", items: rangeOf([row.collectionOf], property) };
      } else if (isList && name === "items") {
        properties[name] = { type: "array", items: rangeOf(["Entity"], property) };
      } else if (entities.length > 0) properties[name] = rangeOf(entities, property);
      else if (row?.types.some((type) => type.toLowerCase() === "integer")) properties[name] = { type: "integer" };
      else if (property !== undefined) properties[name] = property;
    }
    // Every property that the table requires is required here, so that a value cut short at the depth limit still reads.
    const required = [
      "id",
      "type",
      ...[...rows.values()].filter((row) => row.disposition === "Required").map((row) => row.name),
    ];
    definitions[term] = {
      ...original,
      properties,
      required: [...new Set(required)].filter((name) => name in properties),
    };
  }
  return definitions;
}

/** The generator of entities of one class, from the narrowed schema, with every property and a few levels of entities. */
export function entityArbitrary(
  term: string,
  definitions: Record<string, unknown>,
): fc.Arbitrary<Record<string, unknown>> {
  const time = fc
    .date({ min: new Date(0), max: new Date(4e12), noInvalidDate: true })
    .map((date) => date.toISOString());
  const generated = schemaArbitrary(
    { $ref: BASE + term, $defs: definitions },
    {
      formats: {
        [IRI_FORMAT]: fc.webUrl(),
        "date-time": time,
        duration: fc.constantFrom("PT1S", "PT10M30S", "P1D", "P2W", "P1Y2M3DT4H5M6S"),
      },
      properties: {
        id: fc.webUrl(),
        "@context": fc.constant("http://purl.imsglobal.org/ctx/caliper/v1p2"),
        extensions: fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.jsonValue({ maxDepth: 2 }), {
          maxKeys: 2,
        }),
      },
      maxDepth: 3,
      allProperties: true,
    },
  );
  // The schemas of a few classes list no property at all, `@context` among them: a document of the top level has it.
  return (generated as fc.Arbitrary<Record<string, unknown>>).map((entity) => ({
    "@context": "http://purl.imsglobal.org/ctx/caliper/v1p2",
    ...entity,
  }));
}
