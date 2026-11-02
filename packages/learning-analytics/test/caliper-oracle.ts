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
import { CALIPER_1_1_CONTEXT, CALIPER_CONTEXT, type CaliperVersion, LIBRARY_PROFILE_CONTEXT } from "../src/index.js";

/** The repository, whose `.cache/` holds the downloads that these helpers read. */
export const ROOT = resolve(import.meta.dirname, "../../..");

/** The pinned tables of Caliper 1.2 and of the Library Use Profile, which `pnpm caliper-tables` downloads. */
export const TABLES: CaliperTables = readCaliperTables(ROOT, "caliper-1p2.json");
export const LIBRARY_TABLES: CaliperTables = readCaliperTables(ROOT, "caliper-library-1p2.json");

/** The pinned tables of Caliper 1.1, which `pnpm caliper-tables` downloads. */
export const TABLES_1_1: CaliperTables = readCaliperTables(ROOT, "caliper-1p1.json");

/** The `caliper-spec` repository at the pinned commit, which `pnpm corpus` downloads. */
export const CALIPER_SPEC = join(ROOT, ".cache/corpus/caliper-spec");

/** The IRI of a property whose value is an entity or its IRI. */
const IRI_FORMAT = "iri";
const BASE = "#/$defs/";
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

/** Writes an action as the vocabulary of Appendix D does: two pages spell `MarkedAsUnread` as `MarkedAsUnRead`. */
export function spelled(action: string): string {
  return action === "MarkedAsUnRead" ? "MarkedAsUnread" : action;
}

/** What the tests of one version of Caliper compare the reader with: the tables, the schemas and the documents they generate. */
export interface Oracle {
  /** The version of Caliper that the oracle describes. */
  readonly version: CaliperVersion;
  /** The schemas of the version, which `pnpm corpus` downloads, each qualified so that they refer to one another. */
  readonly schemas: SchemaSet;
  /** Every event and entity of the tables, by term; the classes that the version deprecated are left out. */
  readonly classes: ReadonlyMap<string, ClassTable>;
  /** The terms of the entities that have an `id`. */
  readonly entityTerms: readonly string[];
  /** The terms of the events of the tables. */
  readonly eventTerms: readonly string[];
  /** The properties that a class has by the tables: its own, those of its supertypes, and those of the base class. */
  inheritedRows(term: string, base: readonly PropertyRow[]): ReadonlyMap<string, PropertyRow>;
  /** The terms of a class and of every class below it. */
  closure(term: string): string[];
  /** Tells whether the draft 4 schema of the class accepts a value. */
  schemaAccepts(term: string): (value: unknown) => boolean;
  /** The definitions that `documentArbitrary` generates from: the schemas, narrowed to what the tables allow. */
  narrowedDefinitions(): Record<string, unknown>;
  /** The generator of documents of one class, from the narrowed schema, with every property and a few levels of entities. */
  documentArbitrary(
    term: string,
    definitions: Record<string, unknown>,
    identifier?: fc.Arbitrary<string>,
  ): fc.Arbitrary<Record<string, unknown>>;
  /** An entity of a class with the properties that the class requires, and no more. */
  minimal(term: string): Record<string, unknown>;
  /** An event of a class with the actor and the object that its table names first, and the first action it allows. */
  minimalEvent(term: string, changes?: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Makes the oracle of a version from its tables and its schemas.
 *
 * @param version - The version of Caliper.
 * @param base - The page whose tables hold the properties that every event and entity has.
 * @param pages - The pages whose classes the oracle knows: the specification and its extensions.
 * @param schemas - The directory of the schemas of the version in `caliper-spec`.
 */
function createOracle(
  version: CaliperVersion,
  base: CaliperTables,
  pages: readonly CaliperTables[],
  schemas: string,
): Oracle {
  const context = version === "1.2" ? CALIPER_CONTEXT : CALIPER_1_1_CONTEXT;
  const schemaSet = readSchemaSet(join(CALIPER_SPEC, "json_schema", schemas));
  const classes = new Map(
    pages
      .flatMap((page) => [...page.entities, ...page.events])
      .filter((table) => table.deprecated !== true)
      .map((table) => [table.term, table]),
  );
  const entityTerms = pages
    .flatMap((page) => page.entities)
    .filter((table) => table.deprecated !== true)
    .map((table) => table.term)
    .filter((term) => term !== "TextPositionSelector" && term !== "SystemIdentifier");
  const eventTerms = pages
    .flatMap((page) => page.events.filter((table) => table.deprecated !== true))
    .map(({ term }) => term);

  function inheritedRows(term: string, rows: readonly PropertyRow[]): ReadonlyMap<string, PropertyRow> {
    const found = new Map<string, PropertyRow>(rows.map((row) => [row.name, row]));
    const visit = (name: string): void => {
      const table = classes.get(name);
      for (const supertype of table?.supertypes ?? []) visit(supertype);
      for (const row of table?.properties ?? []) if (row.deprecated !== true) found.set(row.name, row);
    };
    visit(term);
    return found;
  }

  function closure(term: string): string[] {
    const below = (name: string): boolean =>
      name === term || (classes.get(name)?.supertypes ?? []).some((supertype) => below(supertype));
    return [...classes.keys()].filter(below);
  }

  /** The range of a property by the tables: the IRI, or an object of one of the classes below the named ones. */
  function rangeOf(types: readonly string[], schemaProperty?: unknown): unknown {
    const inSchema = schemaProperty === undefined ? [] : refsOf(schemaProperty);
    const terms = [...new Set(types.flatMap((term) => closure(term)))].filter(
      (term) => entityTerms.includes(term) && schemaSet.has(term) && (inSchema.length === 0 || inSchema.includes(term)),
    );
    return { anyOf: [{ type: "string", format: IRI_FORMAT }, ...terms.map((term) => ({ $ref: BASE + term }))] };
  }

  /** The part of a table row's type that names classes of entities with an `id`; `Entity` names all of them. */
  const entityTypes = (row: PropertyRow): string[] =>
    row.types.filter((type) => type === "Entity" || entityTerms.includes(type));

  function narrowedDefinitions(): Record<string, unknown> {
    const definitions: Record<string, unknown> = {};
    const prefix = "https://schemas.invalid/set/";
    for (const [name, schema] of schemaSet) definitions[name] = localize(schema, prefix);
    const all: [string, readonly PropertyRow[]][] = [
      ...entityTerms.map((term): [string, readonly PropertyRow[]] => [term, base.entityProperties]),
      ...["Event", ...eventTerms].map((term): [string, readonly PropertyRow[]] => [term, base.eventProperties]),
    ];
    for (const [term, baseRows] of all.filter(([name]) => schemaSet.has(name))) {
      const rows = inheritedRows(term, baseRows);
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
        else if (row?.actions !== undefined) properties[name] = { enum: row.actions.map(spelled) };
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
    // The model takes the collection of measures that the Tool Use Profile names as what a use made, where the table of 1.1 allows
    // any entity; the generator draws what the model reads.
    const toolUse = definitions.ToolUseEvent as { properties?: Record<string, unknown> } | undefined;
    if (version === "1.1" && toolUse?.properties !== undefined) {
      toolUse.properties.generated = rangeOf(["AggregateMeasureCollection"], toolUse.properties.generated);
    }
    // The selector has no `id` and a table of its own: both positions are integers, which the generator draws from 0.
    const selector = definitions.TextPositionSelector as { properties?: Record<string, unknown> } | undefined;
    if (selector?.properties !== undefined) {
      for (const name of ["start", "end"]) selector.properties[name] = { type: "integer" };
    }
    return definitions;
  }

  function documentArbitrary(
    term: string,
    definitions: Record<string, unknown>,
    identifier: fc.Arbitrary<string> = fc.webUrl(),
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
          id: identifier,
          "@context": fc.constant(context),
          extensions: fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.jsonValue({ maxDepth: 2 }), {
            maxKeys: 2,
          }),
        },
        maxDepth: 3,
        allProperties: true,
      },
    );
    // The schemas of a few classes list no property at all, `@context` among them: a document of the top level has it.
    return (generated as fc.Arbitrary<Record<string, unknown>>).map((entity) => ({ "@context": context, ...entity }));
  }

  function minimal(term: string): Record<string, unknown> {
    const required: Record<string, Record<string, unknown>> = {
      AggregateMeasure: { metric: "UnitsCompleted", metricValue: 1 },
      Questionnaire: { items: [] },
    };
    return { id: `https://example.edu/${term}`, type: term, ...required[term] };
  }

  function minimalEvent(term: string, changes: Record<string, unknown> = {}): Record<string, unknown> {
    const rows = inheritedRows(term, base.eventProperties);
    const first = (name: string): string => {
      const types = rows.get(name)?.types ?? ["Entity"];
      return types.find((type) => type === "Entity" || entityTerms.includes(type)) ?? "Entity";
    };
    const action = rows.get("action")?.actions?.[0] ?? "Created";
    return {
      "@context": term.startsWith("Library") ? LIBRARY_PROFILE_CONTEXT : context,
      id: "urn:uuid:3a648e68-f00d-4c08-aa59-8738e1884f2c",
      type: term,
      actor: minimal(first("actor")),
      action: spelled(action),
      object: minimal(first("object")),
      eventTime: "2016-11-15T10:15:00.000Z",
      ...changes,
    };
  }

  return {
    version,
    schemas: schemaSet,
    classes,
    entityTerms,
    eventTerms,
    inheritedRows,
    closure,
    schemaAccepts: (term) => schemaSetValidator(schemaSet, term, "4"),
    narrowedDefinitions,
    documentArbitrary,
    minimal,
    minimalEvent,
  };
}

/** The oracle of Caliper 1.2 and of the Library Use Profile. */
const ORACLE_1_2: Oracle = createOracle("1.2", TABLES, [TABLES, LIBRARY_TABLES], "schema_1_2");

/** The oracle of Caliper 1.1. Its extension profiles have no tables of their own, and their classes are not in it. */
export const ORACLE_1_1: Oracle = createOracle("1.1", TABLES_1_1, [TABLES_1_1], "schema_1_1");

export const CLASSES: ReadonlyMap<string, ClassTable> = ORACLE_1_2.classes;
export const ENTITY_TERMS: readonly string[] = ORACLE_1_2.entityTerms;
export const EVENT_TERMS: readonly string[] = ORACLE_1_2.eventTerms;
export const SCHEMA_1_2: SchemaSet = ORACLE_1_2.schemas;
export const { inheritedRows, closure, schemaAccepts, narrowedDefinitions, documentArbitrary, minimal, minimalEvent } =
  ORACLE_1_2;

/** The fixtures of Caliper 1.2 or of Caliper 1.1: the files that begin with `prefix`, parsed, by file name. */
export function fixtures(
  prefix: string,
  negative = false,
  version: CaliperVersion = "1.2",
): ReadonlyMap<string, string> {
  const directory = join(
    CALIPER_SPEC,
    "fixtures",
    version === "1.2" ? "v1p2" : "v1p1",
    negative ? "commonErrorFixtures" : "",
  );
  return new Map(
    readdirSync(directory)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .map((name) => [name, readFileSync(join(directory, name), "utf8")]),
  );
}

/** The pinned tables of the certification guide of Caliper 1.2, which `pnpm caliper-tables` downloads. */
export const CERTIFICATION_TABLES: CaliperTables = readCaliperTables(ROOT, "caliper-cert-1p2.json");
