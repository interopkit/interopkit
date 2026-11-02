import { describe, expect, it } from "vitest";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import {
  ACTIONS,
  AGENT_TYPES,
  CALIPER_CONTEXT,
  COURSE_OFFERING_TYPES,
  DIGITAL_RESOURCE_TYPES,
  ENTITY_TYPES,
  LTI_MESSAGE_TYPES,
  METRICS,
  ORGANIZATION_TYPES,
  PROFILES,
  QUESTION_TYPES,
  ROLES,
  readEntity,
  SCALE_TYPES,
  STATUSES,
  SYSTEM_IDENTIFIER_TYPES,
} from "../src/index.js";
import { ENTITY_SCHEMAS } from "../src/read/internal.js";
import { CLASSES, closure, ENTITY_TERMS, inheritedRows, LIBRARY_TABLES, ROOT, TABLES } from "./caliper-oracle.js";

/** The names of the properties that the schema of a class of the reader declares, and whether each is required. */
function entriesOf(term: string): Map<string, boolean> {
  const [, object] = Reflect.get(Reflect.get(ENTITY_SCHEMAS, term), "pipe");
  const entries: Record<string, { readonly type: string }> = Reflect.get(object, "entries");
  return new Map(Object.entries(entries).map(([name, schema]) => [name, schema.type !== "optional"]));
}

/** The properties that the fixtures use and the tables do not list, by class: see `spec-gaps.md`. */
const BEYOND_THE_TABLES: Readonly<Record<string, readonly string[]>> = {
  Attempt: ["isPartOf"],
  HighlightAnnotation: ["selection"],
};

describe("the model against the tables of Caliper 1.2 and of the Library Use Profile", () => {
  const sorted = (terms: readonly string[]) => [...terms].sort();

  it("has the entity types of the tables, and the generic Entity", () => {
    const tables = [...TABLES.entities, ...LIBRARY_TABLES.entities].map((table) => table.term);
    expect(sorted(ENTITY_TYPES)).toStrictEqual(sorted(["Entity", ...tables]));
  });

  it.each(ENTITY_TERMS)("has the properties of %s that its table and the tables of its supertypes list", (term) => {
    const rows = inheritedRows(term, TABLES.entityProperties);
    const expected = new Set([...rows.keys(), "@context", ...(BEYOND_THE_TABLES[term] ?? [])]);
    expect(sorted([...entriesOf(term).keys()])).toStrictEqual(sorted([...expected]));
  });

  it("has the properties of the two entities that have no id", () => {
    expect(sorted([...entriesOf("SystemIdentifier").keys()])).toStrictEqual(
      sorted(CLASSES.get("SystemIdentifier")?.properties.map((row) => row.name) ?? []),
    );
    expect(sorted([...entriesOf("TextPositionSelector").keys()])).toStrictEqual(
      sorted(CLASSES.get("TextPositionSelector")?.properties.map((row) => row.name) ?? []),
    );
  });

  it("requires the properties that the tables require", () => {
    const required: string[] = [];
    for (const term of [...ENTITY_TERMS, "SystemIdentifier", "TextPositionSelector"]) {
      for (const row of inheritedRows(term, TABLES.entityProperties).values()) {
        if (row.disposition === "Required") required.push(`${term}.${row.name}`);
      }
    }
    const requiredByReader = [...ENTITY_TERMS, "SystemIdentifier", "TextPositionSelector"].flatMap((term) =>
      [...entriesOf(term).entries()].filter(([, isRequired]) => isRequired).map(([name]) => `${term}.${name}`),
    );
    expect(sorted(requiredByReader.filter((name) => !/\.(id|type)$/u.test(name)))).toStrictEqual(
      sorted(required.filter((name) => !/\.(id|type)$/u.test(name))),
    );
  });

  it("has the vocabularies of the appendices", () => {
    expect(sorted(ACTIONS)).toStrictEqual(sorted([...new Set([...TABLES.actions, ...LIBRARY_TABLES.actions])]));
    // Appendix E leaves out the Survey Profile that section 3 describes, and the Library Use Profile adds its own.
    expect(sorted(PROFILES)).toStrictEqual(sorted([...TABLES.profiles, "SurveyProfile", "LibraryProfile"]));
    // The published context and the schemas define Mentor#Auditor, which Appendix F leaves out.
    expect(sorted(ROLES)).toStrictEqual(sorted([...TABLES.roles, "Mentor#Auditor"]));
    expect(sorted(STATUSES)).toStrictEqual(sorted(TABLES.statuses));
    expect(sorted(LTI_MESSAGE_TYPES)).toStrictEqual(sorted(TABLES.ltiMessageTypes));
    // The published context defines CaseItemUri, which Appendix I leaves out and a fixture uses.
    expect(sorted(SYSTEM_IDENTIFIER_TYPES)).toStrictEqual(
      sorted([...TABLES.systemIdentifierTypes, "CaseItemUri", ...LIBRARY_TABLES.systemIdentifierTypes]),
    );
    expect(sorted(METRICS)).toStrictEqual(sorted(TABLES.metrics));
  });

  it("takes for each range the class that the tables name and every class below it", () => {
    const below = (term: string) => closure(term).filter((name) => ENTITY_TERMS.includes(name));
    expect(sorted(AGENT_TYPES)).toStrictEqual(sorted(below("Agent")));
    expect(sorted(ORGANIZATION_TYPES)).toStrictEqual(sorted(below("Organization")));
    expect(sorted(COURSE_OFFERING_TYPES)).toStrictEqual(sorted(below("CourseOffering")));
    expect(sorted(DIGITAL_RESOURCE_TYPES)).toStrictEqual(sorted(below("DigitalResource")));
    expect(sorted(QUESTION_TYPES)).toStrictEqual(sorted(below("Question")));
    expect(sorted(SCALE_TYPES)).toStrictEqual(sorted(below("Scale")));
  });
});

describe("the entity reader against the examples that the specifications print", () => {
  const blocks = [...readSpecPage(ROOT, "caliper-1p2.json"), ...readSpecPage(ROOT, "caliper-library-1p2.json")];
  const entities = blocks.filter(
    (block): block is Record<string, unknown> =>
      typeof block === "object" &&
      block !== null &&
      !Array.isArray(block) &&
      typeof Reflect.get(block, "type") === "string" &&
      [...ENTITY_TYPES].includes(Reflect.get(block, "type")),
  );

  it("reads every entity that the pages print and returns it as printed, but two that break their own rule", () => {
    expect(entities.length).toBeGreaterThan(80);
    const refused: string[] = [];
    for (const example of entities) {
      // A fragment that a page prints without the context of its document is read under the context of Caliper.
      const document = "@context" in example ? example : { "@context": CALIPER_CONTEXT, ...example };
      try {
        expect(readEntity(document), JSON.stringify(example).slice(0, 80)).toStrictEqual(document);
      } catch (error) {
        refused.push(
          `${String(Reflect.get(example, "id"))}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    // Two examples of the Library Use Profile write a duration as `18m` and `1h`, which is not the ISO 8601 form it requires.
    expect(refused).toStrictEqual([
      'https://example.edu/library/events/3: The entity is invalid at duration: expected an ISO 8601 duration such as PT10M30S, found "18m".',
      'https://example.edu/library/events/3: The entity is invalid at duration: expected an ISO 8601 duration such as PT10M30S, found "1h".',
    ]);
  });
});
