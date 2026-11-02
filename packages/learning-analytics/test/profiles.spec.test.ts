import { describe, expect, it } from "vitest";
import type { ClassTable, ProfileRow } from "../../../scripts/caliper-tables.js";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import { ACTIONS, EVENT_TYPES, PROFILES, validateEvent } from "../src/index.js";
import { CERTIFICATION_ROWS, type ProfileEntry, SPECIFICATION_ROWS, SUBTYPES } from "../src/validate/internal.js";
import {
  CERTIFICATION_TABLES,
  closure,
  ENTITY_TERMS,
  LIBRARY_TABLES,
  minimal,
  minimalEvent,
  ROOT,
  spelled,
  TABLES,
} from "./caliper-oracle.js";

/** A row of a table as a test compares it: the classes of each cell, sorted. */
interface Row {
  readonly profile: string;
  readonly event: string;
  readonly action: string;
  readonly actor: string;
  readonly object: string;
  readonly generated: string;
  readonly target: string;
}

const joined = (classes: readonly string[]): string => [...classes].sort().join(",");
const keyOf = (row: Row): string =>
  [row.profile, row.event, row.action, row.actor, row.object, row.generated, row.target].join("|");

/** The rows that the entries of a table state, one for each action. */
function rowsOfEntries(entries: readonly ProfileEntry[]): Row[] {
  return entries.flatMap((entry) =>
    entry.actions.map((action) => ({
      profile: entry.profile,
      event: entry.event,
      action,
      actor: joined(entry.actor),
      object: joined(entry.object),
      generated: joined(entry.generated),
      target: joined(entry.target),
    })),
  );
}

/** The rows that a page prints. The General Profile allows every action, which the page writes as `any Caliper action` or `*`. */
function rowsOfPage(rows: readonly ProfileRow[]): Row[] {
  return rows.flatMap((row) => {
    const actions = row.action === "any Caliper action" || row.action === "*" ? [...ACTIONS] : [spelled(row.action)];
    return actions.map((action) => ({
      profile: row.profile,
      event: row.event,
      action,
      actor: joined(row.actor),
      object: joined(row.object),
      generated: joined(row.generated),
      target: joined(row.target),
    }));
  });
}

/** The rows of the events of the Library Use Profile, which its page prints as the properties of each event. */
function libraryRows(): Row[] {
  return LIBRARY_TABLES.events.flatMap((table: ClassTable) => {
    const cell = (name: string) => table.properties.find((row) => row.name === name);
    return (cell("action")?.actions ?? []).map((action) => ({
      profile: "LibraryProfile",
      event: table.term,
      action,
      actor: joined(cell("actor")?.types ?? []),
      object: joined(cell("object")?.types ?? []),
      generated: "",
      target: "",
    }));
  });
}

/**
 * The row of the Grading Profile that the certification guide prints with `Viewed` as the object of the ViewEvent and the
 * `Result` that section 3.6 names as the object as the generated entity: its cells are shifted by one.
 */
function corrected(row: Row): Row {
  const shifted = row.profile === "GradingProfile" && row.event === "ViewEvent" && row.object === "Viewed";
  return shifted ? { ...row, object: "Result", generated: "" } : row;
}

const SPECIFICATION_PAGE: Row[] = [...rowsOfPage(TABLES.profileRows), ...libraryRows()];
const CERTIFICATION_PAGE: Row[] = rowsOfPage(CERTIFICATION_TABLES.certificationRows).map(corrected);

const classesNamed = (rows: readonly Row[]): string[] => [
  ...new Set(
    rows.flatMap((row) =>
      [row.actor, row.object, row.generated, row.target]
        .flatMap((cell) => cell.split(","))
        .filter((name) => name !== ""),
    ),
  ),
];

describe("the tables of the profiles against the pages", () => {
  it("has the 91 rows of section 3 and the rows of the General Profile and of the Library Use Profile", () => {
    expect(TABLES.profileRows.filter((row) => row.profile !== "GeneralProfile")).toHaveLength(91);
    expect(SPECIFICATION_PAGE.filter((row) => row.profile === "LibraryProfile")).toHaveLength(3);
    expect(rowsOfEntries(SPECIFICATION_ROWS).map(keyOf).sort()).toStrictEqual(SPECIFICATION_PAGE.map(keyOf).sort());
  });

  it("has the rows of the event conformance tables of the certification guide", () => {
    expect(CERTIFICATION_TABLES.certificationRows.filter((row) => row.profile !== "GeneralProfile")).toHaveLength(92);
    expect(rowsOfEntries(CERTIFICATION_ROWS).map(keyOf).sort()).toStrictEqual(CERTIFICATION_PAGE.map(keyOf).sort());
  });

  it("names the 15 profiles of the guide, and the General Profile, and every one is a profile of the model", () => {
    const profiles = [...new Set(CERTIFICATION_PAGE.map((row) => row.profile))];
    expect(profiles).toHaveLength(15);
    expect(profiles.every((profile) => PROFILES.some((term) => term === profile))).toBe(true);
    expect(new Set(SPECIFICATION_PAGE.map((row) => row.profile)).size).toBe(16);
  });

  it("expands each class that a table names with subtypes to the classes at and below it", () => {
    const named = classesNamed([...SPECIFICATION_PAGE, ...CERTIFICATION_PAGE]);
    expect(named.length).toBeGreaterThan(25);
    for (const name of named) {
      const below = new Set(closure(name));
      below.add(name);
      // The two entities that Appendix C defines without an `id` have no supertype in the tables, but they are entities.
      if (name === "Entity")
        for (const table of [...TABLES.entities, ...LIBRARY_TABLES.entities]) below.add(table.term);
      const given = new Set(SUBTYPES.get(name as never) ?? [name]);
      expect([...given].sort(), name).toStrictEqual([...below].sort());
    }
  });

  it("has an entity class in every cell, and an event of the model in every row", () => {
    for (const row of [...SPECIFICATION_PAGE, ...CERTIFICATION_PAGE]) {
      expect(
        EVENT_TYPES.some((term) => term === row.event),
        row.event,
      ).toBe(true);
      for (const name of classesNamed([row])) expect([...ENTITY_TERMS, "Entity"], name).toContain(name);
    }
  });
});

/** Tells whether a row of a page allows an actor and an object of the given classes. */
function allows(
  rows: readonly Row[],
  profile: string,
  event: string,
  action: string,
  actor: string,
  object: string,
): boolean {
  const inside = (cell: string, type: string): boolean =>
    cell
      .split(",")
      .some((name) => name === type || closure(name).includes(type) || (name === "Entity" && type === "Entity"));
  return rows.some(
    (row) =>
      row.profile === profile &&
      row.event === event &&
      row.action === action &&
      inside(row.actor, actor) &&
      inside(row.object, object),
  );
}

/** The most serious finding of the rules of the tables, `none` when the event follows them. */
function verdict(event: Record<string, unknown>): "none" | "warning" | "error" | "shape" {
  const findings = validateEvent(event);
  if (findings.some((finding) => !finding.rule.startsWith("profile-") && finding.severity === "error")) return "shape";
  const tables = findings.filter(({ rule }) => rule.startsWith("profile-") && rule !== "profile-missing");
  if (tables.some(({ severity }) => severity === "error")) return "error";
  return tables.length > 0 ? "warning" : "none";
}

describe("validateEvent against every row of the tables", () => {
  const rows = [
    ...new Map([...SPECIFICATION_PAGE, ...CERTIFICATION_PAGE].map((row) => [keyOf(row), row])).values(),
  ].filter((row) => row.profile !== "GeneralProfile");
  const first = (cell: string): string => cell.split(",")[0] ?? "Entity";

  it("finds no fault in a minimal event of each row of either table, with its profile and without it", () => {
    for (const row of rows) {
      const base = {
        ...minimalEvent(row.event, { action: row.action }),
        actor: minimal(first(row.actor)),
        object: minimal(first(row.object)),
      };
      for (const event of [{ ...base, profile: row.profile }, base]) {
        const found = verdict(event);
        if (found === "shape") continue;
        expect(found === "none" || found === "warning", `${row.profile} ${row.event} ${row.action}`).toBe(true);
      }
    }
  });

  it("judges the actor and the object of each row as the page of the table does: allowed, a warning when only the guide allows it, or an error", () => {
    let judged = 0;
    for (const row of rows) {
      const event = (actor: string, object: string) => ({
        ...minimalEvent(row.event, { action: row.action, profile: row.profile }),
        actor: minimal(actor),
        object: minimal(object),
      });
      const classes = [...ENTITY_TERMS, "Entity"];
      const variants = [
        ...classes.map((actor) => [actor, first(row.object)] as const),
        ...classes.map((object) => [first(row.actor), object] as const),
      ];
      for (const [actor, object] of variants) {
        const found = verdict(event(actor, object));
        if (found === "shape") continue;
        const strict = allows(SPECIFICATION_PAGE, row.profile, row.event, row.action, actor, object);
        const loose = allows(CERTIFICATION_PAGE, row.profile, row.event, row.action, actor, object);
        const expected = strict ? "none" : loose ? "warning" : "error";
        expect(found, `${row.profile} ${row.event} ${row.action} ${actor} ${object}`).toBe(expected);
        judged += 1;
      }
    }
    expect(judged).toBeGreaterThan(1_000);
  });

  it("refuses an event whose profile has no such event, for every profile and event that no table pairs", () => {
    const paired = new Set([...SPECIFICATION_PAGE, ...CERTIFICATION_PAGE].map((row) => `${row.profile}|${row.event}`));
    let refused = 0;
    for (const profile of PROFILES) {
      for (const event of EVENT_TYPES) {
        const base = minimalEvent(event);
        const findings = validateEvent({ ...base, profile });
        if (findings.some((finding) => finding.rule !== "profile-event" && finding.severity === "error")) continue;
        const named = findings.some(({ rule }) => rule === "profile-event");
        expect(named, `${profile} ${event}`).toBe(!paired.has(`${profile}|${event}`));
        if (named) refused += 1;
      }
    }
    expect(refused).toBeGreaterThan(200);
  });
});

describe("validateEvent against the examples that the specifications print", () => {
  const blocks = [...readSpecPage(ROOT, "caliper-1p2.json"), ...readSpecPage(ROOT, "caliper-library-1p2.json")];
  const events = blocks.filter(
    (block): block is Record<string, unknown> =>
      typeof block === "object" &&
      block !== null &&
      !Array.isArray(block) &&
      EVENT_TYPES.some((type) => type === Reflect.get(block, "type")),
  );

  it("finds no error in an event that a page prints and the reader takes, but those that break a rule of the profile", () => {
    const errors: string[] = [];
    for (const example of events) {
      const found = validateEvent(example).filter(({ severity }) => severity === "error");
      if (
        found.length > 0 &&
        found.every(({ rule }) => rule.startsWith("profile-") || rule === "media-location-time")
      ) {
        errors.push(
          `${String(example.id)} ${String(example.type)} ${found.map(({ path, rule }) => `${path} ${rule}`).join(", ")}`,
        );
      }
    }
    expect(errors).toStrictEqual([]);
  });
});
