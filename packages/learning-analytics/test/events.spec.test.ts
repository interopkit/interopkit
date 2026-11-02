import { describe, expect, it } from "vitest";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import { ACTIONS, ENTITY_TYPES, EVENT_TYPES, readEvent } from "../src/index.js";
import { EVENT_SCHEMAS } from "../src/read/internal.js";
import {
  CLASSES,
  closure,
  ENTITY_TERMS,
  EVENT_TERMS,
  inheritedRows,
  LIBRARY_TABLES,
  minimal,
  minimalEvent,
  ROOT,
  spelled,
  TABLES,
} from "./caliper-oracle.js";

const sorted = (terms: readonly string[]) => [...terms].sort();

/** The names of the properties that the schema of an event declares, and whether each is required. */
function entriesOf(schema: unknown): Map<string, boolean> {
  const found: unknown = Reflect.get(schema as object, "entries");
  if (typeof found === "object" && found !== null) {
    return new Map(Object.entries(found).map(([name, entry]) => [name, Reflect.get(entry, "type") !== "optional"]));
  }
  const pipe: unknown = Reflect.get(schema as object, "pipe");
  for (const item of Array.isArray(pipe) ? pipe : []) {
    const inner = entriesOf(item);
    if (inner.size > 0) return inner;
  }
  return new Map();
}

/** The schema of an event of the reader, by its term. */
const schemaOf = (term: string): unknown => Reflect.get(EVENT_SCHEMAS, term);

/** The properties that the fixtures use beyond the tables, by event and property, with the class that they add. */
const BEYOND_THE_TABLES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  AssessmentItemEvent: { generated: "Attempt" },
};

/** Tells whether the reader takes an event. */
function reads(value: unknown): boolean {
  try {
    readEvent(value);
    return true;
  } catch {
    return false;
  }
}

describe("the model against the tables of the events", () => {
  it("has the event types of the tables, and the generic Event", () => {
    expect(sorted(EVENT_TYPES)).toStrictEqual(sorted(["Event", ...EVENT_TERMS]));
    expect(EVENT_TERMS).toHaveLength(24);
  });

  it.each(["Event", ...EVENT_TERMS])(
    "has the properties of %s that its table and the table of the event list",
    (term) => {
      const expected = [...inheritedRows(term, TABLES.eventProperties).keys(), "@context"];
      expect(sorted([...entriesOf(schemaOf(term)).keys()])).toStrictEqual(sorted(expected));
    },
  );

  it.each(["Event", ...EVENT_TERMS])("requires of %s what the tables require", (term) => {
    const required = [...entriesOf(schemaOf(term))].filter(([, isRequired]) => isRequired).map(([name]) => name);
    expect(sorted(required)).toStrictEqual(
      sorted(["@context", "id", "type", "actor", "action", "object", "eventTime"]),
    );
    for (const row of inheritedRows(term, TABLES.eventProperties).values()) {
      if (row.disposition === "Required") expect(required, `${term}.${row.name}`).toContain(row.name);
    }
  });

  it.each(EVENT_TERMS)("allows of %s the actions that its table names, and no other", (term) => {
    const allowed = (inheritedRows(term, TABLES.eventProperties).get("action")?.actions ?? []).map(spelled);
    expect(allowed.length).toBeGreaterThan(0);
    for (const action of ACTIONS) {
      const event = minimalEvent(term, { action });
      // A copy needs the resource that it made, and a launch the session of its platform.
      const takes = [{}, { generated: minimal("Document") }, { federatedSession: minimal("LtiSession") }].some((more) =>
        reads({ ...event, ...more }),
      );
      expect(takes, `${term} ${action}`).toBe(allowed.includes(action));
    }
  });

  it.each(["Event", ...EVENT_TERMS])(
    "takes for each entity property of %s the classes that its table names",
    (term) => {
      const rows = inheritedRows(term, TABLES.eventProperties);
      for (const name of ["actor", "object", "target", "generated", "referrer"]) {
        const named = (rows.get(name)?.types ?? []).filter((type) => type === "Entity" || ENTITY_TERMS.includes(type));
        const extra = BEYOND_THE_TABLES[term]?.[name];
        const allowed = new Set([...named, ...(extra === undefined ? [] : [extra])].flatMap((type) => closure(type)));
        if (named.includes("Entity")) allowed.add("Entity");
        for (const entity of [...ENTITY_TERMS, "Entity"]) {
          const event = minimalEvent(term, { [name]: minimal(entity), ...(name === "generated" ? {} : {}) });
          const takes = reads(event) || reads({ ...event, federatedSession: minimal("LtiSession") });
          const expected =
            allowed.has(entity) ||
            ((name === "target" || name === "generated" || name === "referrer") && named.includes("Entity"));
          expect(takes, `${term}.${name} ${entity}`).toBe(expected);
        }
      }
    },
  );

  it("requires the session of the platform of a launch, and the resource that a copy made", () => {
    expect(reads(minimalEvent("ToolLaunchEvent", { action: "Launched" }))).toBe(false);
    expect(
      reads(minimalEvent("ToolLaunchEvent", { action: "Launched", federatedSession: minimal("LtiSession") })),
    ).toBe(true);
    expect(reads(minimalEvent("ToolLaunchEvent", { action: "Returned" }))).toBe(true);
    expect(reads(minimalEvent("ResourceManagementEvent", { action: "Copied" }))).toBe(false);
    expect(reads(minimalEvent("ResourceManagementEvent", { action: "Copied", generated: minimal("Document") }))).toBe(
      true,
    );
    expect(reads(minimalEvent("ResourceManagementEvent", { action: "Created" }))).toBe(true);
  });

  it("has the properties of the three events of the Library Use Profile", () => {
    expect(LIBRARY_TABLES.events.map((table) => table.term)).toStrictEqual([
      "LibraryUseEvent",
      "LibraryResourceUseEvent",
      "LibraryParticipationEvent",
    ]);
    expect(CLASSES.has("LibraryUseEvent")).toBe(true);
    expect(ENTITY_TYPES).toContain("LibraryActivity");
  });
});

describe("the event reader against the examples that the specifications print", () => {
  const blocks = [...readSpecPage(ROOT, "caliper-1p2.json"), ...readSpecPage(ROOT, "caliper-library-1p2.json")];
  const events = blocks.filter(
    (block): block is Record<string, unknown> =>
      typeof block === "object" &&
      block !== null &&
      !Array.isArray(block) &&
      EVENT_TYPES.some((type) => type === Reflect.get(block, "type")),
  );

  it("reads every event that the pages print and returns it as printed, but one that breaks its own rule", () => {
    expect(events.length).toBeGreaterThan(60);
    const refused: string[] = [];
    for (const example of events) {
      try {
        expect(readEvent(example), String(example.id)).toStrictEqual(example);
      } catch (error) {
        refused.push(
          `${String(example.id)} ${String(example.type)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    // An example of the Library Use Profile gives the type of an identifier as `ISBN`, and the profile's term is
    // `InternationalStandardBookNumber`.
    expect(refused).toStrictEqual([
      'urn:uuid:0652c71d-e477-4692-9b4e-89c4079e00e0 LibraryResourceUseEvent: The event is invalid at object.otherIdentifiers[0].identifierType: expected a type of system identifier of Caliper, found "ISBN".',
    ]);
  });
});
