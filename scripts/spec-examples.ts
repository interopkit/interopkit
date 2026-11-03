import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { downloadText } from "./download.ts";
import { mapConcurrently, sha256 } from "./schemas.ts";

/**
 * A specification page, or a Markdown file when the address ends in `.md`, whose JSON examples tests read, pinned to the
 * SHA-256 of the examples that it holds.
 */
export interface SpecPage {
  /** The address of the page. */
  readonly url: string;
  /** The name of the file of its examples in the examples directory. */
  readonly file: string;
  /** The SHA-256 of the examples as `jsonBlocks` finds them, written as JSON, as lowercase hexadecimal. */
  readonly sha256: string;
  /**
   * Whether the examples are the JSON bodies that `httpBodyBlocks` finds, those of HTTP exchanges included, and not only the
   * blocks that are JSON as a whole.
   *
   * @defaultValue `false`
   */
  readonly bodies?: boolean;
}

/** The examples of the specifications that the tests read, by role in the tests. */
export interface SpecExamples {
  /** The launch of LTI Core Appendix E: an `LtiResourceLinkRequest` with every claim. */
  readonly launch: Readonly<Record<string, unknown>>;
  /** The Deep Linking request of Deep Linking Appendix A. */
  readonly deepLinkingRequest: Readonly<Record<string, unknown>>;
  /** The Deep Linking response of Deep Linking Appendix B. */
  readonly deepLinkingResponse: Readonly<Record<string, unknown>>;
  /** The scores of AGS 3.4, in the order of the page. */
  readonly scores: readonly Readonly<Record<string, unknown>>[];
}

const LOCK_PATH = "scripts/spec-examples.lock.json";
/** Where the examples are written, relative to the repository root. */
const EXAMPLES_PATH = ".cache/spec-examples";
const MESSAGE_TYPE = "https://purl.imsglobal.org/spec/lti/claim/message_type";

/** Decodes the entities of the pages: the five that HTML text needs, and numeric references. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Returns the JSON values that the preformatted blocks of a page hold, in order; a block that is not JSON is skipped. */
export function jsonBlocks(html: string): unknown[] {
  const values: unknown[] = [];
  for (const [, block] of html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gu)) {
    const text = decodeEntities((block ?? "").replace(/<[^>]+>/gu, "")).trim();
    try {
      values.push(JSON.parse(text));
    } catch {
      // A block of code in another language, or a fragment with an ellipsis, is not an example to read.
    }
  }
  return values;
}

/** The tokens that matter for finding where a JSON value ends: a string, with its escapes, and a bracket. */
const BRACKET_OR_STRING = /"(?:[^"\\]|\\.)*"|[{}[\]]/gu;

/** Returns the index after the JSON value that starts at `from`, which is a `{` or a `[`, or `-1` when the text ends inside it. */
function endOfValue(text: string, from: number): number {
  let depth = 0;
  BRACKET_OR_STRING.lastIndex = from;
  for (let match = BRACKET_OR_STRING.exec(text); match !== null; match = BRACKET_OR_STRING.exec(text)) {
    if (match[0] === "{" || match[0] === "[") depth += 1;
    else if (!match[0].startsWith('"')) depth -= 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return -1;
}

/**
 * Returns the JSON values that the preformatted blocks of a page hold, in order: a block that is JSON as a whole, and a block
 * that prints an HTTP exchange, with request or status lines and headers around its JSON, a request body and the body of its
 * answer among them. A value starts at a line that begins with `{` or `[` and ends where its brackets close; one that is not
 * JSON, or is an ellipsis, is skipped.
 */
export function httpBodyBlocks(html: string): unknown[] {
  const values: unknown[] = [];
  for (const [, block] of html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gu)) {
    // The examples of some pages indent with no-break spaces, which JSON does not take as white space.
    const text = decodeEntities((block ?? "").replace(/<[^>]+>/gu, "").replaceAll("&nbsp;", " "))
      .replaceAll("\u00a0", " ")
      .trim();
    for (let at = 0; at < text.length; ) {
      const start = text.slice(at).search(/^[{[]/mu);
      if (start < 0) break;
      const end = endOfValue(text, at + start);
      if (end < 0) break;
      try {
        values.push(JSON.parse(text.slice(at + start, end)));
      } catch {
        // A block of another language, a fragment with an ellipsis or an example with a mistake is not an example to read.
      }
      at = end;
    }
  }
  return values;
}

/**
 * Returns the JSON values that the fenced blocks of a Markdown page hold, in order. A block of members, such as
 * `"definition": { ... }`, is read as an object; a block that is not JSON is skipped.
 */
export function markdownJsonBlocks(markdown: string): unknown[] {
  const values: unknown[] = [];
  for (const [, block] of markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gmu)) {
    const text = (block ?? "").trim();
    for (const candidate of [text, `{${text}}`]) {
      try {
        values.push(JSON.parse(candidate));
        break;
      } catch {
        // A block of another language, a request line or a fragment with an ellipsis is not an example to read.
      }
    }
  }
  return values;
}

/** Returns the hash that a page is pinned by: the SHA-256 of its examples written as JSON. */
export function examplesHash(blocks: readonly unknown[]): string {
  return sha256(new TextEncoder().encode(JSON.stringify(blocks)));
}

/** Reads the list of pinned pages. */
export function loadLock(root: string): SpecPage[] {
  return JSON.parse(readFileSync(join(root, LOCK_PATH), "utf8"));
}

/** Returns the directory the examples are written to. */
export function examplesDirectory(root: string): string {
  return join(root, EXAMPLES_PATH);
}

/** Tells whether a file holds the bytes of a pinned hash. */
function isWritten(file: string, pinned: string): boolean {
  return existsSync(file) && sha256(readFileSync(file)) === pinned;
}

/** Downloads a page and returns its examples. */
async function readPage(page: SpecPage): Promise<unknown[]> {
  const text = await downloadText(page.url);
  if (page.url.endsWith(".md")) return markdownJsonBlocks(text);
  return page.bodies === true ? httpBodyBlocks(text) : jsonBlocks(text);
}

/**
 * Downloads the pages and writes their examples, each only when the examples have the pinned hash. The pages differ in bytes
 * from one download to the next, so the examples are what is pinned.
 *
 * @throws `Error` when a download fails or the examples of a page differ from the pinned ones; that page is not written.
 */
export async function fetchSpecExamples(root: string): Promise<void> {
  const directory = examplesDirectory(root);
  mkdirSync(directory, { recursive: true });
  const reasons = await mapConcurrently(loadLock(root), async (page) => {
    try {
      // Examples written already with their pinned hash are not read again, so a cache of them saves the pages.
      if (isWritten(join(directory, page.file), page.sha256)) return undefined;
      const blocks = await readPage(page);
      const hash = examplesHash(blocks);
      if (hash !== page.sha256)
        return `The examples of ${page.url} have the SHA-256 ${hash}, not the pinned ${page.sha256}.`;
      writeFileSync(join(directory, page.file), JSON.stringify(blocks));
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  const failures = reasons.filter((reason) => reason !== undefined);
  if (failures.length > 0) {
    throw new Error(
      `Not every page could be read:${failures.map((reason) => `\n- ${reason}`).join("")}\nRun pnpm spec-examples:pin if a page changed.`,
    );
  }
}

/** Downloads every page and writes the hash of its examples into the list. */
export async function pinSpecExamples(root: string): Promise<void> {
  const pages = loadLock(root);
  const hashes = await mapConcurrently(pages, async (page) => examplesHash(await readPage(page)));
  const pinned = pages.map((page, index) => ({ ...page, sha256: hashes[index] }));
  writeFileSync(join(root, LOCK_PATH), `${JSON.stringify(pinned, null, 2)}\n`);
  console.log(`Pinned ${pinned.length} pages.`);
}

/** Finds the block of examples of the given kind among the blocks of all pages. */
function find(
  blocks: readonly unknown[],
  matches: (block: Readonly<Record<string, unknown>>) => boolean,
): Readonly<Record<string, unknown>> {
  const found = blocks.find(
    (block): block is Readonly<Record<string, unknown>> =>
      typeof block === "object" && block !== null && !Array.isArray(block) && matches(block as Record<string, unknown>),
  );
  if (found === undefined) throw new Error("The pinned pages hold no such example.");
  return found;
}

/**
 * Reads the JSON blocks of one page, in the order of the page, from the directory that `fetchSpecExamples` wrote.
 *
 * @param root - The repository.
 * @param file - The name of the file of the page in the lock.
 * @throws `Error` when the examples are not downloaded.
 */
export function readSpecPage(root: string, file: string): unknown[] {
  const directory = examplesDirectory(root);
  if (!existsSync(directory)) {
    throw new Error(`The specification examples are not downloaded to ${directory}: run pnpm spec-examples first.`);
  }
  return JSON.parse(readFileSync(join(directory, file), "utf8"));
}

/**
 * Reads the examples that tests use from the directory that `fetchSpecExamples` wrote.
 *
 * @throws `Error` when the examples are not downloaded, or a page no longer holds an example the tests need.
 */
export function readSpecExamples(root: string): SpecExamples {
  const directory = examplesDirectory(root);
  if (!existsSync(directory)) {
    throw new Error(`The specification examples are not downloaded to ${directory}: run pnpm spec-examples first.`);
  }
  const blocks = loadLock(root).flatMap((page): unknown[] =>
    JSON.parse(readFileSync(join(directory, page.file), "utf8")),
  );
  const ofType = (type: string) => (block: Readonly<Record<string, unknown>>) => block[MESSAGE_TYPE] === type;
  return {
    launch: find(blocks, ofType("LtiResourceLinkRequest")),
    deepLinkingRequest: find(blocks, ofType("LtiDeepLinkingRequest")),
    deepLinkingResponse: find(blocks, ofType("LtiDeepLinkingResponse")),
    scores: blocks.filter(
      (block): block is Readonly<Record<string, unknown>> =>
        typeof block === "object" && block !== null && "gradingProgress" in block,
    ),
  };
}

async function main(args: readonly string[]): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const [command] = args;
  if (command === "fetch") {
    await fetchSpecExamples(root);
    console.log("The specification examples are current.");
  } else if (command === "pin") {
    await pinSpecExamples(root);
  } else {
    throw new Error("Usage: node scripts/spec-examples.ts fetch | pin");
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
