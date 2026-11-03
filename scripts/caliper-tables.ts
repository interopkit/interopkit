import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { downloadText } from "./download.ts";
import { mapConcurrently, sha256 } from "./schemas.ts";

/** A specification page of Caliper whose tables tests read, pinned to the SHA-256 of the tables that `parseCaliperPage` finds. */
export interface CaliperPage {
  /** The address of the page. */
  readonly url: string;
  /** The name of the file of its tables in the tables directory. */
  readonly file: string;
  /** The SHA-256 of the tables written as JSON, as lowercase hexadecimal. */
  readonly sha256: string;
  /** How the page is laid out: the numbered sections of Caliper 1.2 and its extensions, or those of Caliper 1.1. Default: `current`. */
  readonly layout?: "current" | "v1p1";
}

/** One row of the property table of an event or an entity: the name, the types of its value and its disposition. */
export interface PropertyRow {
  /** The name of the property. */
  readonly name: string;
  /** The types of the value in the order of the table, `IRI` left out: `["Person"]` for `Person | IRI`, `["Term"]`. */
  readonly types: readonly string[];
  /** Whether the value is an entity that the table allows as its IRI too. */
  readonly iri: boolean;
  /** The disposition as the table prints it: `Required`, `Optional`, or a condition. */
  readonly disposition: string;
  /** The class that the members of a list belong to, when the description names it: `AssessmentItem` for the items of an assessment. */
  readonly collectionOf?: string;
  /** The actions that the description of an `action` row limits the event to, in the spelling of the page. */
  readonly actions?: readonly string[];
  /** Present when the disposition says that the property is targeted for removal. Caliper 1.1 marks its deprecated properties so. */
  readonly deprecated?: true;
}

/** An event or an entity as a page lists it: its term, its supertypes and the rows of its table of properties. */
export interface ClassTable {
  /** The term, which is the `type` of its instances. */
  readonly term: string;
  /** The supertypes the page names; the generic classes have the base class. */
  readonly supertypes: readonly string[];
  /** The rows of the table, `type` among them. */
  readonly properties: readonly PropertyRow[];
  /** Present when the page marks the class as deprecated. Caliper 1.1 does so for the events and entities it retired. */
  readonly deprecated?: true;
  /** The actions of an event that the page lists as deprecated, in the spelling of the page. Caliper 1.1 lists them. */
  readonly deprecatedActions?: readonly string[];
}

/**
 * One row of a table of a profile: an event, an action and the classes that the profile allows for what the action involves.
 * Section 3 of the specification prints the table as event, actor, action, object and the generated entity or the target; the
 * certification guide prints it as event, action, actor, object, a recommended generated entity and whether certification
 * requires the row.
 */
export interface ProfileRow {
  /** The term of the profile that the table belongs to, such as `AssessmentProfile`. */
  readonly profile: string;
  /** The term of the event. */
  readonly event: string;
  /** The action in the spelling of the page. */
  readonly action: string;
  /** The classes of the actor, as the cell prints them. */
  readonly actor: readonly string[];
  /** The classes of the object, as the cell prints them. */
  readonly object: readonly string[];
  /** The classes of the generated entity; empty when the table has none for the row. */
  readonly generated: readonly string[];
  /** The classes of the target; empty when the table has none for the row. */
  readonly target: readonly string[];
  /** The `Required or Optional` cell of the certification guide. Absent in section 3. */
  readonly disposition?: string;
}

/** What tests read of a page of Caliper: the classes, the actions and the vocabularies, by the order of the page. */
export interface CaliperTables {
  /** The base properties of an event (section 2.1). Empty on a page that defines none. */
  readonly eventProperties: readonly PropertyRow[];
  /** The base properties of an entity (section 2.2). Empty on a page that defines none. */
  readonly entityProperties: readonly PropertyRow[];
  /** The rows of the tables of the profiles in section 3 of the specification. Empty on a page that has none. */
  readonly profileRows: readonly ProfileRow[];
  /** The rows of the event conformance tables of the certification guide. Empty on a page that has none. */
  readonly certificationRows: readonly ProfileRow[];
  /** The events of the appendix of events, or of the section of events of an extension. */
  readonly events: readonly ClassTable[];
  /** The entities of the appendix of entities and of the entities that have no id. */
  readonly entities: readonly ClassTable[];
  /** The terms of the actions. */
  readonly actions: readonly string[];
  /** The terms of the profiles. */
  readonly profiles: readonly string[];
  /** The terms of the roles and sub-roles of a membership. */
  readonly roles: readonly string[];
  /** The terms of the statuses of a membership. */
  readonly statuses: readonly string[];
  /** The terms of the message types of an LTI link. */
  readonly ltiMessageTypes: readonly string[];
  /** The terms of the types of a system identifier. */
  readonly systemIdentifierTypes: readonly string[];
  /** The terms of the metrics of an aggregate measure. */
  readonly metrics: readonly string[];
}

const LOCK_PATH = "scripts/caliper-tables.lock.json";
/** Where the tables are written, relative to the repository root. */
const TABLES_PATH = ".cache/caliper-tables";

/** One heading of a page with the markup that follows it up to the next heading. */
interface Chunk {
  /** The level of the heading, 2 to 4. */
  readonly level: number;
  /** The id of the heading. */
  readonly id: string;
  /** The markup from the heading to the next one. */
  readonly body: string;
}

/** How a description names the class of the members of a list: `collection of AssessmentItem entities`, `array of one or more Questionnaire entities`. */
const COLLECTION_OF = /(?:collection|array) of (?:one or more )?([A-Z]\w+) entities/u;

/** The words that start a sentence of a description and are no action. */
const NOT_ACTIONS = new Set(["The", "Term"]);

/** Reads the actions from the sentence of an `action` row that says which ones the event is limited to. */
function actionsOf(description: string): string[] {
  const limited = /limited to (?!the set)([\s\S]*)/u.exec(description)?.[1] ?? "";
  return [...limited.matchAll(/\b[A-Z][A-Za-z]*\b/gu)].map(([word]) => word).filter((word) => !NOT_ACTIONS.has(word));
}

/** Decodes the entities of the pages: the five that HTML text needs, and numeric references. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
}

/** Returns the text of some markup: tags removed, entities decoded, white space collapsed. */
function textOf(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]+>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

/** Cuts a page at its headings of levels 2 to 4. */
function chunksOf(html: string): Chunk[] {
  const headings = [...html.matchAll(/<h([2-4]) id="([^"]*)"[^>]*>/gu)];
  return headings.map((heading, index) => ({
    level: Number(heading[1]),
    id: heading[2] ?? "",
    body: html.slice((heading.index ?? 0) + heading[0].length, headings[index + 1]?.index ?? html.length),
  }));
}

/** Returns the title of a section: the text of its heading, without the number. */
function titleOf(chunk: Chunk): string {
  const end = chunk.body.indexOf("</h");
  // A heading of the certification guide holds the anchor of a broken link whose title quotes a tag, which would end the tag early.
  return textOf(
    chunk.body
      .slice(0, end < 0 ? 0 : end)
      .replace(/<bdi[^>]*>[\s\S]*?<\/bdi>/gu, "")
      .replace(/<a [^>]*respec-offending-element[\s\S]*?<\/a>/gu, ""),
  );
}

/** Reads the definition list of a section as terms and what they define. */
function definitionsOf(body: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const [, name = "", value = ""] of body.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gu)) {
    found.set(textOf(name), textOf(value));
  }
  return found;
}

/** Reads the table of properties of a section: the rows with a name, the types and a disposition. */
function rowsOf(body: string): PropertyRow[] {
  const table = /<table[\s\S]*?<\/table>/u.exec(body)?.[0] ?? "";
  const rows: PropertyRow[] = [];
  for (const [, row = ""] of table.matchAll(/<tr>([\s\S]*?)<\/tr>/gu)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gu)].map(([, cell = ""]) => textOf(cell));
    const [name, type, description, disposition] = cells;
    if (name === undefined || type === undefined || description === undefined || disposition === undefined) continue;
    const parts = type.split("|").map((part) => part.trim());
    const collectionOf = COLLECTION_OF.exec(description)?.[1];
    const actions = name === "action" ? actionsOf(description) : [];
    rows.push({
      name,
      types: parts.filter((part) => part !== "IRI"),
      iri: parts.includes("IRI"),
      disposition,
      ...(collectionOf === undefined ? {} : { collectionOf }),
      ...(actions.length === 0 ? {} : { actions }),
    });
  }
  return rows;
}

/** The cells of a row in the order of the table: the text of each, with the cells that the row spans left out. */
function cellsOf(row: string): string[] {
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gu)].map(([, cell = ""]) => textOf(cell));
}

/**
 * The classes that a cell of a profile table names: `Link | LtiLink` gives two, `Agent or subtype` gives the one class, and
 * `Entity (AggregateMeasureCollection)` gives the class in the parentheses, which narrows the entity.
 */
function classesIn(cell: string | undefined): string[] {
  return (cell ?? "").split("|").flatMap((part) => {
    const narrowed = /\(\s*([A-Z]\w*)\s*\)/u.exec(part)?.[1];
    const named = narrowed ?? /[A-Z]\w*/u.exec(part)?.[0];
    return named === undefined ? [] : [named];
  });
}

/** The key of a column of a profile table, by its heading in section 3 and in the certification guide. */
const PROFILE_COLUMNS: Readonly<
  Record<string, "event" | "action" | "actor" | "object" | "generated" | "target" | "disposition">
> = {
  event: "event",
  action: "action",
  actor: "actor",
  object: "object",
  generated: "generated",
  "recommended generated entity": "generated",
  target: "target",
  "required or optional": "disposition",
};

/**
 * Reads the first table of a section as rows of a profile. A row that names an action and no event belongs to the event of
 * the row before it, as the certification guide prints them; a row that names an event alone only opens that event.
 */
function profileRowsIn(body: string, profile: string, withDisposition: boolean): ProfileRow[] {
  const table = /<table[\s\S]*?<\/table>/u.exec(body)?.[0] ?? "";
  const heads = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gu)].map(([, cell = ""]) => textOf(cell).toLowerCase());
  const columns = heads.map((head) => PROFILE_COLUMNS[head]);
  const rows: ProfileRow[] = [];
  let event = "";
  for (const [, markup = ""] of table.matchAll(/<tr>([\s\S]*?)<\/tr>/gu)) {
    const cells = cellsOf(markup);
    if (cells.length === 0) continue;
    const at = (key: (typeof columns)[number]): string | undefined => cells[columns.indexOf(key)];
    event = at("event") || event;
    const action = at("action") ?? "";
    // The row of the certification guide that opens an event has no action; section 3 has an action in every row.
    if (action === "") continue;
    rows.push({
      profile,
      event,
      action,
      actor: classesIn(at("actor")),
      object: classesIn(at("object")),
      generated: classesIn(at("generated")),
      target: classesIn(at("target")),
      ...(withDisposition ? { disposition: at("disposition") ?? "" } : {}),
    });
  }
  return rows;
}

/** The term of a profile from the title of its section: `Tool launch Profile` is `ToolLaunchProfile`. */
function profileTerm(title: string): string {
  return title
    .replace(/^[\d.\s]+/u, "")
    .split(/\s+/u)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Reads the profile tables of a section: the table of each profile in section 3, which sits under the heading of the profile, or
 * the event conformance table of each profile in the certification guide, which sits under a heading of its own.
 */
function profileRowsOf(chunks: readonly Chunk[], withDisposition: boolean): ProfileRow[] {
  let profile = "";
  return chunks.flatMap((chunk) => {
    if (chunk.level === 3) profile = profileTerm(titleOf(chunk));
    const isTable = withDisposition ? chunk.id.startsWith("event-conformance-table") : chunk.level === 3;
    return isTable && profile !== "" ? profileRowsIn(chunk.body, profile, withDisposition) : [];
  });
}

/** Splits a list of terms: `A, B and C`. */
function termsIn(list: string | undefined): string[] {
  return (list ?? "").split(/[,\s]+/u).filter((term) => term !== "" && term !== "and");
}

/** Reads a chunk that defines a class. */
function classOf(chunk: Chunk): ClassTable | undefined {
  const definitions = definitionsOf(chunk.body);
  const term = definitions.get("Term");
  if (term === undefined) return undefined;
  const supertypes = termsIn(definitions.get("Supertype") ?? definitions.get("Supertypes"));
  return { term, supertypes, properties: rowsOf(chunk.body) };
}

/**
 * Reads the classes of the sections of an appendix. The entities that have no id print their table under a heading of its own,
 * `Properties`, which belongs to the class before it.
 */
function classesOf(chunks: readonly Chunk[]): ClassTable[] {
  const classes: ClassTable[] = [];
  for (const chunk of chunks) {
    const found = classOf(chunk);
    const last = classes.at(-1);
    if (found !== undefined) classes.push(found);
    else if (titleOf(chunk) === "Properties" && last !== undefined) {
      classes[classes.length - 1] = { ...last, properties: [...last.properties, ...rowsOf(chunk.body)] };
    }
  }
  return classes;
}

/** Returns the terms of the sections of an appendix: the `Term` of each, or its title when it has none. */
function vocabularyOf(chunks: readonly Chunk[]): string[] {
  return chunks.flatMap((chunk) => {
    const term = definitionsOf(chunk.body).get("Term");
    return term === undefined ? [] : [term];
  });
}

/** The ids of the headings of level 2 that open the sections of the Caliper 1.2 specification and its extensions. */
const SECTIONS: Readonly<Record<string, keyof CaliperTables | "ignored">> = {
  "events-0": "events",
  "entities-0": "entities",
  "entities-with-no-id-properties": "entities",
  "actions-0": "actions",
  "profile-terms-0": "profiles",
  "lis-roles-0": "roles",
  "lis-statuses-0": "statuses",
  "lti-message-types": "ltiMessageTypes",
  "system-identifier-types": "systemIdentifierTypes",
  "use-metrics": "metrics",
  "profiles-0": "profileRows",
  "metric-profile-certification": "certificationRows",
  // The sections of an extension, which names its events, actions and entities in the numbered sections 3 to 5.
  "events-extension": "events",
  "actions-extension": "actions",
  "entities-extension": "entities",
};

/**
 * Reads the tables of a page of Caliper: the base properties of events and entities, every event and entity with its
 * supertypes and its table of properties, and the terms of the actions and of the vocabularies.
 *
 * @remarks
 * The page of an extension uses the section ids of `SECTIONS`; a section a page does not have gives an empty list. The text of
 * the descriptions is not kept: the tables hold what a test compares, and the specification's text stays on the page.
 */
export function parseCaliperPage(html: string): CaliperTables {
  const chunks = chunksOf(html);
  const lists: Record<string, ClassTable[] | string[]> = {
    events: [],
    entities: [],
    actions: [],
    profiles: [],
    roles: [],
    statuses: [],
    ltiMessageTypes: [],
    systemIdentifierTypes: [],
    metrics: [],
  };
  let current: keyof CaliperTables | "ignored" = "ignored";
  const groups = new Map<keyof CaliperTables, Chunk[]>();
  for (const chunk of chunks) {
    if (chunk.level === 2) current = SECTIONS[chunk.id] ?? "ignored";
    else if (current !== "ignored") groups.set(current, [...(groups.get(current) ?? []), chunk]);
  }
  for (const key of ["events", "entities"] as const) lists[key] = classesOf(groups.get(key) ?? []);
  for (const key of [
    "actions",
    "profiles",
    "roles",
    "statuses",
    "ltiMessageTypes",
    "systemIdentifierTypes",
    "metrics",
  ] as const) {
    lists[key] = vocabularyOf(groups.get(key) ?? []);
  }
  const base = (id: string): PropertyRow[] => rowsOf(chunks.find((chunk) => chunk.id === id)?.body ?? "");
  return {
    eventProperties: base("event"),
    entityProperties: base("entity"),
    profileRows: profileRowsOf(groups.get("profileRows") ?? [], false),
    certificationRows: profileRowsOf(groups.get("certificationRows") ?? [], true),
    events: lists.events as ClassTable[],
    entities: lists.entities as ClassTable[],
    actions: lists.actions as string[],
    profiles: lists.profiles as string[],
    roles: lists.roles as string[],
    statuses: lists.statuses as string[],
    ltiMessageTypes: lists.ltiMessageTypes as string[],
    systemIdentifierTypes: lists.systemIdentifierTypes as string[],
    metrics: lists.metrics as string[],
  };
}

/** One heading of the page of Caliper 1.1 with the markup that follows it up to the next heading of level 2 or 3. */
interface Section {
  /** The level of the heading, 2 or 3. */
  readonly level: number;
  /** The anchor of the heading. */
  readonly id: string;
  /** The text of the heading, with its number: `B.10 OutcomeEvent DEPRECATED`. */
  readonly title: string;
  /** The markup after the heading. */
  readonly body: string;
}

/**
 * The headings of an appendix class of the page of Caliper 1.1: `<h3><a name="id"></a>C.2 Annotation</h3>`. The page writes two of
 * them wrongly, `C.4 AssessmentItem` as a paragraph that begins `*###` and `C.43 SoftwareApplication` as a heading of level 4,
 * and both are read as the level 3 that their neighbors have.
 */
const APPENDIX_HEADING =
  /<h([2-4])>(?:<a name="([^"]*)"><\/a>)?([\s\S]*?)<\/h\1>|<p>\*###\s*<a name="([^"]*)"><\/a>([^<]*)<\/p>/gu;

/** Cuts the page of Caliper 1.1 at its headings of levels 2 and 3, and at the classes of its appendices wherever they are written. */
function sectionsOf(html: string): Section[] {
  const headings = [...html.matchAll(APPENDIX_HEADING)]
    .map((match) => {
      const wrong = match[1] === undefined;
      const title = textOf(match[3] ?? match[5] ?? "");
      const level = wrong ? 3 : Number(match[1]);
      return {
        match,
        level: level === 4 && /^[A-D]\.\d+ /u.test(title) ? 3 : level,
        id: match[2] ?? match[4] ?? "",
        title,
      };
    })
    // A heading without a number, such as `Required properties` inside the section of Organization, does not open a section.
    .filter(({ level, title }) => level === 2 || (level === 3 && /^(?:\d+|[A-H])\.\d+ /u.test(title)));
  return headings.map(({ match, level, id, title }, index) => ({
    level,
    id,
    title,
    body: html.slice((match.index ?? 0) + match[0].length, headings[index + 1]?.match.index ?? html.length),
  }));
}

/** The paragraphs that follow the heading of level 4 with a title, up to the next heading, as text. */
function paragraphsUnder(body: string, title: string): string[] {
  const start = body.search(new RegExp(`<h4>${title}</h4>`, "u"));
  if (start < 0) return [];
  const rest = body.slice(start + title.length + 9);
  const end = rest.search(/<(?:h4|table|pre)\b/u);
  return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(/<p>([\s\S]*?)<\/p>/gu)].map(([, paragraph = ""]) =>
    textOf(paragraph),
  );
}

/** Splits a comma-separated list of terms, which an appendix prints as `A, B, C`. */
function listOf(text: string | undefined): string[] {
  return (text ?? "").split(",").flatMap((term) => (term.trim() === "" ? [] : [term.trim()]));
}

/** Tells whether a section of an appendix defines a class: its title has the number of an appendix, such as `C.2`. */
function isClassSection(section: Section): boolean {
  return /^[B-D]\.\d+ /u.test(section.title);
}

/** The term of a class from the title of its appendix section: `B.10 OutcomeEvent DEPRECATED` is `OutcomeEvent`. */
function termOf11(title: string): string {
  return (/^[A-Z]\.\d+ (\w+)/u.exec(title)?.[1] ?? "").trim();
}

/** Reads a section of Appendix B, C or D that defines an event or an entity of Caliper 1.1. */
function classOf11(section: Section): ClassTable {
  const [supertypes] = paragraphsUnder(section.body, "Supertype");
  const [supported] = paragraphsUnder(section.body, "Supported Actions");
  // The section of an event that says why the actions are deprecated lists them in a second paragraph; the others have the list alone.
  const deprecated = paragraphsUnder(section.body, "Deprecated Actions").at(-1);
  const [properties, retired] = section.body.split(/<h4>Deprecated Properties<\/h4>/u);
  const rows = rowsOf(properties ?? "").map((row) =>
    // The description of the `action` row says only that the range is the list above, which the heading `Supported Actions` gives.
    row.name === "action" ? { ...row, actions: listOf(supported) } : row,
  );
  return {
    term: termOf11(section.title),
    supertypes: listOf(supertypes),
    properties: [...rows, ...rowsOf(retired ?? "").map((row) => ({ ...row, deprecated: true as const }))],
    ...(/DEPRECATED/u.test(section.title) ? { deprecated: true as const } : {}),
    ...(deprecated === undefined ? {} : { deprecatedActions: listOf(deprecated) }),
  };
}

/** The terms in the first column of the tables of a section, which print `Term (IRI)` or `Term`. */
function firstColumn(body: string): string[] {
  return [...body.matchAll(/<tr>\s*<td[^>]*>([\s\S]*?)<\/td>/gu)].map(
    ([, cell = ""]) => textOf(cell).split(" ")[0] ?? "",
  );
}

/**
 * Reads the tables of the page of Caliper 1.1: the properties of an event and of an entity (sections 2.1 and 2.2), every event,
 * entity and selector of Appendices B to D with its supertypes, supported and deprecated actions and properties, and the actions,
 * the profiles, the roles and the statuses. Section 3 of 1.1 lists the profiles in prose and prints no table of rows, so the
 * profile tables are empty.
 */
export function parseCaliper11Page(html: string): CaliperTables {
  const sections = sectionsOf(html);
  const after = (id: string, level: number): Section[] => {
    const start = sections.findIndex((section) => section.id === id);
    const end = sections.findIndex((section, index) => index > start && section.level <= level);
    return sections.slice(start + 1, end < 0 ? undefined : end);
  };
  const body = (id: string): string => sections.find((section) => section.id === id)?.body ?? "";
  return {
    eventProperties: rowsOf(body("event")),
    entityProperties: rowsOf(body("entity")),
    profileRows: [],
    certificationRows: [],
    events: after("events", 2).filter(isClassSection).map(classOf11),
    entities: [...after("entities", 2), ...after("selectors", 2)].filter(isClassSection).map(classOf11),
    actions: firstColumn(body("actions")),
    profiles: after("profiles", 2)
      .filter((section) => /^3\.\d+ /u.test(section.title))
      .map((section) => profileTerm(section.title)),
    roles: firstColumn(body("roles")),
    statuses: firstColumn(body("status")),
    ltiMessageTypes: [],
    systemIdentifierTypes: [],
    metrics: [],
  };
}

/** Returns the hash that a page is pinned by: the SHA-256 of its tables written as JSON. */
export function tablesHash(tables: CaliperTables): string {
  return sha256(new TextEncoder().encode(JSON.stringify(tables)));
}

/** Reads the list of pinned pages. */
export function loadLock(root: string): CaliperPage[] {
  return JSON.parse(readFileSync(join(root, LOCK_PATH), "utf8"));
}

/** Returns the directory the tables are written to. */
export function tablesDirectory(root: string): string {
  return join(root, TABLES_PATH);
}

/** Tells whether a file holds the bytes of a pinned hash. */
function isWritten(file: string, pinned: string): boolean {
  return existsSync(file) && sha256(readFileSync(file)) === pinned;
}

/** Downloads a page and returns its tables. */
async function readPage(page: CaliperPage): Promise<CaliperTables> {
  const html = await downloadText(page.url);
  return page.layout === "v1p1" ? parseCaliper11Page(html) : parseCaliperPage(html);
}

/**
 * Downloads the pages and writes their tables, each only when the tables have the pinned hash. The pages differ in bytes from
 * one download to the next, so the tables are what is pinned.
 *
 * @throws `Error` when a download fails or the tables of a page differ from the pinned ones; that page is not written.
 */
export async function fetchCaliperTables(root: string): Promise<void> {
  const directory = tablesDirectory(root);
  mkdirSync(directory, { recursive: true });
  const reasons = await mapConcurrently(loadLock(root), async (page) => {
    try {
      // Tables written already with their pinned hash are not read again, so a cache of them saves the pages.
      if (isWritten(join(directory, page.file), page.sha256)) return undefined;
      const tables = await readPage(page);
      const hash = tablesHash(tables);
      if (hash !== page.sha256)
        return `The tables of ${page.url} have the SHA-256 ${hash}, not the pinned ${page.sha256}.`;
      writeFileSync(join(directory, page.file), JSON.stringify(tables));
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  const failures = reasons.filter((reason) => reason !== undefined);
  if (failures.length > 0) {
    throw new Error(
      `Not every page could be read:${failures.map((reason) => `\n- ${reason}`).join("")}\nRun pnpm caliper-tables:pin if a page changed.`,
    );
  }
}

/** Downloads every page and writes the hash of its tables into the list. */
export async function pinCaliperTables(root: string): Promise<void> {
  const pages = loadLock(root);
  const hashes = await mapConcurrently(pages, async (page) => tablesHash(await readPage(page)));
  const pinned = pages.map((page, index) => ({ ...page, sha256: hashes[index] }));
  writeFileSync(join(root, LOCK_PATH), `${JSON.stringify(pinned, null, 2)}\n`);
  console.log(`Pinned ${pinned.length} pages.`);
}

/**
 * Reads the tables of one page from the directory that `fetchCaliperTables` wrote.
 *
 * @param root - The repository.
 * @param file - The name of the file of the page in the lock.
 * @throws `Error` when the tables are not downloaded.
 */
export function readCaliperTables(root: string, file: string): CaliperTables {
  const directory = tablesDirectory(root);
  if (!existsSync(directory)) {
    throw new Error(`The Caliper tables are not downloaded to ${directory}: run pnpm caliper-tables first.`);
  }
  return JSON.parse(readFileSync(join(directory, file), "utf8"));
}

async function main(args: readonly string[]): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const [command] = args;
  if (command === "fetch") {
    await fetchCaliperTables(root);
    console.log("The Caliper tables are current.");
  } else if (command === "pin") {
    await pinCaliperTables(root);
  } else {
    throw new Error("Usage: node scripts/caliper-tables.ts fetch | pin");
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
