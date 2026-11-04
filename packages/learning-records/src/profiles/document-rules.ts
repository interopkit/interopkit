import { describe, type Issue, isRecord } from "@interopkit/core/checks";
import { error, item, member, warning } from "../read/internal.js";
import { CONCEPT_TABLES, TABLE_ENTRIES } from "./schemas.js";

/** The objects of a profile whose properties the tables of the specification list. */
type Kind = "profile" | "version" | "author" | "concept" | "template" | "rule" | "pattern" | "data";

/** The properties that the specification lists for each object, and for each type of concept: the entries of its schema. */
const PROPERTIES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(TABLE_ENTRIES).map(([table, entries]) => [table, Object.keys(entries)]),
);

/** The objects that the properties of an object hold, by the kind of the object. */
const CHILDREN: Readonly<Partial<Record<Kind, Readonly<Record<string, Kind>>>>> = {
  profile: { versions: "version", author: "author", concepts: "concept", templates: "template", patterns: "pattern" },
  template: { rules: "rule" },
};

/** Returns the properties that the specification lists for an object of a kind, or none for data that it does not describe. */
function propertiesOf(kind: Kind, value: Readonly<Record<string, unknown>>): readonly string[] | undefined {
  if (kind === "concept") return PROPERTIES[CONCEPT_TABLES.get(String(value.type)) ?? ""];
  return PROPERTIES[kind];
}

/** The properties that the specification describes for some object of a profile. */
const DESCRIBED: ReadonlySet<string> = new Set(Object.values(PROPERTIES).flat());

/**
 * Tells whether a name may be a property that the table of its object does not list: a JSON-LD keyword, `id` and `type`, which
 * the context of the specification makes aliases of `@id` and `@type`, or an IRI.
 */
function isOpenProperty(name: string): boolean {
  return name.startsWith("@") || name === "id" || name === "type" || name.includes(":");
}

/** Tells whether a value is one that a profile must not have: null, an empty string, an empty object, an empty array. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

/**
 * Judges what a profile holds as JSON, below every object: a value that is null or empty, and a property that the table of its
 * object does not list and that is neither a JSON-LD keyword nor an IRI.
 *
 * @param value - The profile as it was given, whose shape the schema read.
 */
export function* documentIssues(value: unknown, kind: Kind = "profile", path = ""): Generator<Issue> {
  if (isEmpty(value)) {
    yield error(
      path,
      "empty-value",
      `expected no null, empty string, empty object or empty array, found ${describe(value)}.`,
    );
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) yield* documentIssues(entry, kind, item(path, index));
    return;
  }
  if (!isRecord(value)) return;
  const known = propertiesOf(kind, value);
  for (const [name, entry] of Object.entries(value)) {
    if (known !== undefined && !known.includes(name) && !isOpenProperty(name)) {
      // A property that the specification describes for another object expands to an IRI of its context, so it is not one
      // that the specification does not describe; it still has no meaning here.
      yield DESCRIBED.has(name)
        ? warning(
            path,
            "property-out-of-place",
            `expected a property that the specification lists here, found ${JSON.stringify(name)}, which it describes for another object.`,
          )
        : error(
            path,
            "unknown-property",
            `expected a property that the specification lists here, a JSON-LD keyword or an IRI, found ${JSON.stringify(name)}.`,
          );
    }
    yield* documentIssues(entry, CHILDREN[kind]?.[name] ?? "data", member(path, name));
  }
}
