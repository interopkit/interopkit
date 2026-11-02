import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  fetchCaliperTables,
  loadLock,
  parseCaliperPage,
  readCaliperTables,
  tablesDirectory,
  tablesHash,
} from "../caliper-tables.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "interopkit-caliper-tables-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** A table of properties in the markup of the pages: a name, a type, a description and a disposition for each row. */
function table(...rows: readonly (readonly [string, string, string, string])[]): string {
  const cells = rows.map(([name, type, description, disposition]) => {
    return `<tr><td>${name}</td><td>${type}</td><td>${description}</td><td>${disposition}</td></tr>`;
  });
  return `<table><thead><tr><th>Property</th></tr></thead><tbody>${cells.join("")}</tbody></table>`;
}

/** A section that defines a class: its heading and the list of its term, supertype and properties. */
function section(id: string, term: string, supertype: string | undefined, rows: string): string {
  const supertypes = supertype === undefined ? "" : `<dt>Supertype</dt><dd><a href="#x">${supertype}</a></dd>`;
  return `<h3 id="${id}"><bdi>B.1 </bdi>${term}</h3><dl><dt>Term</dt><dd>${term}</dd>${supertypes}</dl>${rows}`;
}

const PAGE = [
  '<h3 id="event">2.1 Event</h3>',
  table(["id", "UUID", "The id.", "Required"], ["actor", "Agent | IRI", "The actor.", "Required"]),
  '<h3 id="entity">2.2 Entity</h3>',
  table(["id", "IRI", "The id.", "Required"], ["name", "string", "The name.", "Optional"]),
  '<h2 id="events-0">A. Events</h2>',
  section("a1", "NavigationEvent", "Event", table(["type", "Term", "The type.", "Required"])),
  '<h2 id="entities-0">B. Entities</h2>',
  section(
    "b1",
    "Assessment",
    "AssignableDigitalResource</a>, <a>DigitalResourceCollection",
    table(
      [
        "items",
        "Array",
        "An ordered collection of <a>AssessmentItem</a> entities. Each array item is an IRI.",
        "Optional",
      ],
      ["maxScore", "decimal", "The most.", "Optional"],
      ["scale", "Scale | IRI", "The scale &amp; its <b>label</b>.", "Optional ( for ratings )"],
    ),
  ),
  '<h2 id="entities-with-no-id-properties">C. Entities with no id properties</h2>',
  section("c1", "TextPositionSelector", undefined, ""),
  '<h4 id="properties-0">Properties</h4>',
  table(["start", "integer", "The start.", "Required"]),
  '<h2 id="actions-0">D. Actions</h2>',
  section("d1", "Started", undefined, ""),
  section("d2", "Paused", undefined, ""),
  '<h2 id="lis-statuses-0">G. LIS Statuses</h2>',
  section("g1", "Active", undefined, ""),
  '<h2 id="revision-history">K. Revision History</h2>',
  section("k1", "Ignored", undefined, ""),
].join("\n");

describe("parseCaliperPage", () => {
  const tables = parseCaliperPage(PAGE);

  it("reads the base properties of events and entities from sections 2.1 and 2.2", () => {
    expect(tables.eventProperties.map((row) => row.name)).toStrictEqual(["id", "actor"]);
    expect(tables.entityProperties.map((row) => row.name)).toStrictEqual(["id", "name"]);
  });

  it("reads a class with its supertypes, its rows and what each row says of its value", () => {
    const [assessment] = tables.entities;
    expect(assessment?.term).toBe("Assessment");
    expect(assessment?.supertypes).toStrictEqual(["AssignableDigitalResource", "DigitalResourceCollection"]);
    expect(assessment?.properties[0]).toStrictEqual({
      name: "items",
      types: ["Array"],
      iri: false,
      disposition: "Optional",
      collectionOf: "AssessmentItem",
    });
    expect(assessment?.properties[2]).toMatchObject({
      types: ["Scale"],
      iri: true,
      disposition: "Optional ( for ratings )",
    });
  });

  it("reads the table under a heading of its own as the properties of the class before it", () => {
    expect(tables.entities.at(-1)).toMatchObject({
      term: "TextPositionSelector",
      properties: [{ name: "start", types: ["integer"], disposition: "Required" }],
    });
  });

  it("reads the events, the actions and the statuses, and leaves the sections it does not know", () => {
    expect(tables.events.map((event) => event.term)).toStrictEqual(["NavigationEvent"]);
    expect(tables.actions).toStrictEqual(["Started", "Paused"]);
    expect(tables.statuses).toStrictEqual(["Active"]);
    expect(tables.roles).toStrictEqual([]);
  });

  it("reads a page with none of the sections as empty tables", () => {
    expect(parseCaliperPage("<html></html>")).toMatchObject({
      events: [],
      entities: [],
      actions: [],
      eventProperties: [],
    });
  });
});

describe("tablesHash", () => {
  it("is the SHA-256 of the tables as JSON, changes when a table changes, and not when only a description does", () => {
    const hash = tablesHash(parseCaliperPage(PAGE));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tablesHash(parseCaliperPage(PAGE.replace("<td>decimal</td>", "<td>integer</td>")))).not.toBe(hash);
    expect(tablesHash(parseCaliperPage(PAGE.replace("The most.", "The greatest number.")))).toBe(hash);
  });
});

describe("the lock", () => {
  it("pins every page to an https address of the specifications, a file name and the hash of its tables", () => {
    const lock = loadLock(join(import.meta.dirname, "../.."));
    expect(lock.length).toBe(2);
    for (const { url, file, sha256 } of lock) {
      expect(url).toMatch(/^https:\/\/www\.imsglobal\.org\/spec\/caliper/u);
      expect(file).toMatch(/^[a-z0-9-]+\.json$/);
      expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("fetchCaliperTables", () => {
  function setUp(name: string, hash: string): string {
    const root = join(directory, name);
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(
      join(root, "scripts/caliper-tables.lock.json"),
      JSON.stringify([{ url: "https://spec.example/caliper", file: "page.json", sha256: hash }]),
    );
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(PAGE)));
    return root;
  }

  it("writes the tables of a page that has the pinned hash", async () => {
    const root = setUp("pinned", tablesHash(parseCaliperPage(PAGE)));
    await fetchCaliperTables(root);
    expect(JSON.parse(readFileSync(join(tablesDirectory(root), "page.json"), "utf8"))).toStrictEqual(
      parseCaliperPage(PAGE),
    );
    expect(readCaliperTables(root, "page.json").actions).toStrictEqual(["Started", "Paused"]);
  });

  it("writes nothing and names both hashes when the tables differ from the pinned ones", async () => {
    const root = setUp("changed", "0".repeat(64));
    await expect(fetchCaliperTables(root)).rejects.toThrow(/have the SHA-256 [0-9a-f]{64}, not the pinned 0{64}/);
  });

  it("names the page that could not be downloaded", async () => {
    const root = setUp("missing", "0".repeat(64));
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 404 })));
    await expect(fetchCaliperTables(root)).rejects.toThrow(
      "Downloading https://spec.example/caliper failed: HTTP 404.",
    );
  });
});

describe("readCaliperTables", () => {
  it("says how to download the tables when the directory is missing", () => {
    expect(() => readCaliperTables(join(directory, "none"), "page.json")).toThrow("run pnpm caliper-tables first");
  });
});
