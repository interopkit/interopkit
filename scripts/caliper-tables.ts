import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mapConcurrently, sha256 } from "./schemas.ts";

/** A specification page of Caliper whose tables tests read, pinned to the SHA-256 of the tables that `parseCaliperPage` finds. */
export interface CaliperPage {
  /** The address of the page. */
  readonly url: string;
  /** The name of the file of its tables in the tables directory. */
  readonly file: string;
  /** The SHA-256 of the tables written as JSON, as lowercase hexadecimal. */
  readonly sha256: string;
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
}

/** An event or an entity as a page lists it: its term, its supertypes and the rows of its table of properties. */
export interface ClassTable {
  /** The term, which is the `type` of its instances. */
  readonly term: string;
  /** The supertypes the page names; the generic classes have the base class. */
  readonly supertypes: readonly string[];
  /** The rows of the table, `type` among them. */
  readonly properties: readonly PropertyRow[];
}

/** What tests read of a page of Caliper: the classes, the actions and the vocabularies, by the order of the page. */
export interface CaliperTables {
  /** The base properties of an event (section 2.1). Empty on a page that defines none. */
  readonly eventProperties: readonly PropertyRow[];
  /** The base properties of an entity (section 2.2). Empty on a page that defines none. */
  readonly entityProperties: readonly PropertyRow[];
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
  return textOf(chunk.body.slice(0, end < 0 ? 0 : end).replace(/<bdi[^>]*>[\s\S]*?<\/bdi>/gu, ""));
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

/** Downloads a page and returns its tables. */
async function readPage(page: CaliperPage): Promise<CaliperTables> {
  const response = await fetch(page.url);
  if (!response.ok) throw new Error(`Downloading ${page.url} failed: HTTP ${response.status}.`);
  return parseCaliperPage(await response.text());
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
