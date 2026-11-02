import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  CALIPER_1_1_CONTEXT,
  ENTITY_TYPES,
  EVENT_TYPES,
  ROLES,
  readEntity,
  readEvent,
  STATUSES,
} from "../src/index.js";
import { SCHEMA_SETS } from "../src/read/internal.js";
import { DEPRECATED_IN_1_1, NOT_IN_1_1, propertiesNotIn1p1, TERMS_NOT_IN_1_1 } from "../src/v1p1/index.js";
import { ORACLE_1_1, spelled, TABLES_1_1 } from "./caliper-oracle.js";
import { EXTENSION_TERMS_1_1 } from "./context-oracle.js";

const { classes, entityTerms, eventTerms, inheritedRows, closure, minimal, minimalEvent } = ORACLE_1_1;

const V1P1 = { version: "1.1" } as const;
const sorted = (terms: readonly string[]) => [...terms].sort();

/** The terms that the contexts of the extension profiles define, among the terms of a vocabulary of the model. */
const extensionTermsOf = (vocabulary: readonly string[]): string[] => [
  ...new Set([...EXTENSION_TERMS_1_1.values()].flatMap((terms) => vocabulary.filter((term) => terms.has(term)))),
];

/** The names of the properties that the schema of a class of the reader declares, and whether each is required. */
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

const entitySchemaOf = (term: string): unknown => Reflect.get(SCHEMA_SETS["1.1"].entities, term);
const eventSchemaOf = (term: string): unknown => Reflect.get(SCHEMA_SETS["1.1"].events, term);

/** The properties that a reader of 1.1 declares for a class: those of the model, but the ones that 1.2 added. */
const declaredBy = (term: string, schema: unknown): string[] =>
  [...entriesOf(schema).keys()].filter((name) => !propertiesNotIn1p1(term).includes(name));

/** Tells whether the reader of 1.1 takes an event. */
function takesEvent(value: unknown): boolean {
  try {
    readEvent(value, V1P1);
    return true;
  } catch {
    return false;
  }
}

/** Tells whether the reader of 1.1 takes an entity describe. */
function takesEntity(value: unknown): boolean {
  try {
    readEntity(value, V1P1);
    return true;
  } catch {
    return false;
  }
}

describe("the model against the tables of Caliper 1.1 and the contexts of its extension profiles", () => {
  it("has the 15 events and the 48 entities of the tables, 7 of which 1.1 deprecated", () => {
    expect(TABLES_1_1.events).toHaveLength(15);
    expect(TABLES_1_1.entities.filter(({ term }) => term !== "TextPositionSelector")).toHaveLength(48);
    expect(TABLES_1_1.events.filter(({ deprecated }) => deprecated).map(({ term }) => term)).toStrictEqual([
      "OutcomeEvent",
      "ReadingEvent",
    ]);
  });

  it("reads the events of the tables that 1.1 keeps, the generic Event, and those of its extension profiles", () => {
    const read = EVENT_TYPES.filter((type) => !NOT_IN_1_1.events.some((added) => added === type));
    expect(sorted(read)).toStrictEqual(sorted(["Event", ...eventTerms, ...extensionTermsOf(EVENT_TYPES)]));
  });

  it("reads the entities of the tables that 1.1 keeps, the generic Entity, and those of its extension profiles", () => {
    const read = ENTITY_TYPES.filter((type) => !NOT_IN_1_1.entities.some((added) => added === type));
    expect(sorted(read)).toStrictEqual(
      sorted(["Entity", ...entityTerms, "TextPositionSelector", ...extensionTermsOf(ENTITY_TYPES)]),
    );
  });

  it("leaves out of 1.1 exactly the classes that its tables and extension profiles do not have", () => {
    const defined = new Set([
      "Event",
      "Entity",
      ...classes.keys(),
      ...extensionTermsOf([...EVENT_TYPES, ...ENTITY_TYPES]),
    ]);
    const added = [...EVENT_TYPES, ...ENTITY_TYPES].filter((type) => !defined.has(type));
    expect(sorted(added)).toStrictEqual(sorted([...NOT_IN_1_1.events, ...NOT_IN_1_1.entities]));
  });

  it("lists as deprecated the classes that the tables mark, and none of them is in the model", () => {
    const marked = [...TABLES_1_1.events, ...TABLES_1_1.entities].filter(({ deprecated }) => deprecated);
    expect(sorted(marked.map(({ term }) => term))).toStrictEqual(
      sorted([...DEPRECATED_IN_1_1.events, ...DEPRECATED_IN_1_1.entities]),
    );
    for (const { term } of marked) expect([...EVENT_TYPES, ...ENTITY_TYPES], term).not.toContain(term);
  });

  it.each(entityTerms)("declares for %s the properties that its table and those of its supertypes keep", (term) => {
    const expected = [...inheritedRows(term, TABLES_1_1.entityProperties).keys(), "@context"];
    expect(sorted(declaredBy(term, entitySchemaOf(term)))).toStrictEqual(sorted(expected));
  });

  it("declares for the selector the properties of its table", () => {
    const expected = classes.get("TextPositionSelector")?.properties.map((row) => row.name) ?? [];
    expect(sorted([...entriesOf(entitySchemaOf("TextPositionSelector")).keys()])).toStrictEqual(sorted(expected));
  });

  it.each(["Event", ...eventTerms])(
    "declares for %s the properties that its table and the table of the event keep",
    (term) => {
      const expected = [...inheritedRows(term, TABLES_1_1.eventProperties).keys(), "@context"];
      expect(sorted(declaredBy(term, eventSchemaOf(term)))).toStrictEqual(sorted(expected));
    },
  );

  it("requires the properties that the tables require, of every entity and every event", () => {
    const required = (schema: unknown) =>
      [...entriesOf(schema)].filter(([, isRequired]) => isRequired).map(([name]) => name);
    for (const term of entityTerms) {
      const expected = [...inheritedRows(term, TABLES_1_1.entityProperties).values()]
        .filter((row) => row.disposition === "Required")
        .map((row) => row.name);
      expect(sorted(required(entitySchemaOf(term))), term).toStrictEqual(sorted(expected));
    }
    for (const term of ["Event", ...eventTerms]) {
      const expected = [...inheritedRows(term, TABLES_1_1.eventProperties).values()]
        .filter((row) => row.disposition === "Required")
        .map((row) => row.name);
      // The table of the ViewEvent leaves the disposition of its `type` empty, as every other table writes `Required`.
      const typeRequired = term === "ViewEvent" ? ["type"] : [];
      expect(sorted(required(eventSchemaOf(term))), term).toStrictEqual(
        sorted(["@context", ...typeRequired, ...expected]),
      );
    }
  });

  it("refuses every property that the tables deprecate, of every class that has one", () => {
    let refused = 0;
    for (const table of [...TABLES_1_1.entities, ...TABLES_1_1.events]) {
      if (table.deprecated) continue;
      for (const row of table.properties.filter(({ deprecated }) => deprecated)) {
        const isEvent = eventTerms.includes(table.term);
        const base = isEvent
          ? minimalEvent(table.term, { "@context": CALIPER_1_1_CONTEXT })
          : { "@context": CALIPER_1_1_CONTEXT, ...minimal(table.term) };
        const takes = isEvent ? takesEvent({ ...base, [row.name]: "x" }) : takesEntity({ ...base, [row.name]: "x" });
        expect(takes, `${table.term}.${row.name}`).toBe(false);
        refused += 1;
      }
    }
    expect(refused).toBe(60);
  });

  it("refuses every property of the model that its table does not keep, in the entities that 1.1 describes", () => {
    for (const term of entityTerms) {
      const kept = new Set(inheritedRows(term, TABLES_1_1.entityProperties).keys());
      for (const name of entriesOf(
        SCHEMA_SETS["1.2"].entities[term as keyof (typeof SCHEMA_SETS)["1.2"]["entities"]],
      ).keys()) {
        if (kept.has(name) || name === "@context") continue;
        expect(
          takesEntity({ "@context": CALIPER_1_1_CONTEXT, ...minimal(term), [name]: "https://example.edu/x" }),
          `${term}.${name}`,
        ).toBe(false);
      }
    }
  });
});

describe("the actions of the events against the tables of Caliper 1.1", () => {
  it.each(eventTerms)("allows of %s the actions that its table names, and no other", (term) => {
    const allowed = (inheritedRows(term, TABLES_1_1.eventProperties).get("action")?.actions ?? []).map(spelled);
    expect(allowed.length).toBeGreaterThan(0);
    for (const action of ACTIONS) {
      expect(takesEvent(minimalEvent(term, { action })), `${term} ${action}`).toBe(allowed.includes(action));
    }
  });

  it("refuses the actions that the tables deprecate for an event, which the generic Event keeps", () => {
    const deprecated = TABLES_1_1.events.flatMap((table) =>
      (table.deprecatedActions ?? []).map((action) => [table.term, action] as const),
    );
    expect(deprecated.length).toBeGreaterThan(15);
    for (const [term, action] of deprecated) {
      if (term === "OutcomeEvent" || term === "ReadingEvent") continue;
      expect(takesEvent(minimalEvent(term, { action })), `${term} ${action}`).toBe(false);
      expect(takesEvent(minimalEvent("Event", { action })), `Event ${action}`).toBe(true);
    }
  });

  it("allows the generic Event the actions of the table of Appendix A and of the extension profiles, and no other", () => {
    const allowed = new Set([...TABLES_1_1.actions.map(spelled), ...extensionTermsOf(ACTIONS)]);
    for (const action of ACTIONS) {
      expect(takesEvent(minimalEvent("Event", { action })), action).toBe(allowed.has(action));
    }
    expect(allowed.size).toBe(
      ACTIONS.length -
        TERMS_NOT_IN_1_1.filter(({ property }) => property === "action").flatMap(({ terms }) => terms).length,
    );
  });
});

describe("the vocabularies against the tables of Caliper 1.1", () => {
  it("has the roles of Appendix E but the one that 1.2 added, and the statuses of Appendix F", () => {
    const notIn1p1 = TERMS_NOT_IN_1_1.filter(({ property }) => property === "roles").flatMap(({ terms }) => terms);
    expect(sorted(ROLES.filter((role) => !notIn1p1.some((added) => added === role)))).toStrictEqual(
      sorted([...TABLES_1_1.roles]),
    );
    expect(sorted(STATUSES)).toStrictEqual(sorted(TABLES_1_1.statuses));
  });

  it("names as the profiles of 1.1 the ten of its section 3", () => {
    expect(TABLES_1_1.profiles).toHaveLength(10);
  });

  it("takes for each range of an event the classes that its table names and every class below them", () => {
    const named = (types: readonly string[]) => types.filter((type) => type === "Entity" || entityTerms.includes(type));
    const differences: string[] = [];
    for (const term of ["Event", ...eventTerms]) {
      const rows = inheritedRows(term, TABLES_1_1.eventProperties);
      for (const name of ["actor", "object", "target", "generated", "referrer"]) {
        const types = named(rows.get(name)?.types ?? []);
        const allowed = new Set(types.flatMap((type) => closure(type)));
        if (types.includes("Entity")) allowed.add("Entity");
        for (const entity of [...entityTerms, "Entity"]) {
          const expected = allowed.has(entity) || (name !== "actor" && name !== "object" && types.includes("Entity"));
          if (takesEvent(minimalEvent(term, { [name]: minimal(entity) })) !== expected) {
            differences.push(`${term}.${name} ${entity}`);
          }
        }
      }
    }
    // The fixtures give an attempt as what the start of an item made, which the table of its event does not name. The table of the
    // ToolUseEvent allows any entity as what a use made, and the model takes the AggregateMeasureCollection that the Tool Use
    // Profile names, in both versions.
    expect(differences.filter((difference) => !difference.startsWith("ToolUseEvent.generated "))).toStrictEqual([
      "AssessmentItemEvent.generated Attempt",
    ]);
    expect(differences).toContain("ToolUseEvent.generated Document");
    expect(differences).not.toContain("ToolUseEvent.generated AggregateMeasureCollection");
  });
});
