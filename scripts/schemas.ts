import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { downloadBytes } from "./download.ts";

/** The extractions that an entry may name; each turns a page into the text that its specification holds. */
export const EXTRACTIONS = ["portal-page"] as const;

/** A file that tests read, pinned to the SHA-256 of its bytes, or of the text that an extraction takes from it. */
export interface SchemaFile {
  /** The address the file is downloaded from. */
  readonly url: string;
  /** The name of the file in the schema directory. */
  readonly file: string;
  /**
   * The extraction that turns the download into the file: the page of a living site changes its navigation and its styling
   * between fetches, so the pin is the hash of the text of the specification, which is also what the file holds and the tests
   * read. Without one, the file is the download itself.
   */
  readonly extract?: (typeof EXTRACTIONS)[number];
  /** The SHA-256 of the file as lowercase hexadecimal. */
  readonly sha256: string;
}

const LIST_PATH = "scripts/schemas.lock.json";
/** Where the files are downloaded to, relative to the repository root. */
const CACHE_PATH = ".cache/schemas";
/** Downloads that run at once. */
const CONCURRENCY = 4;

/** Returns the SHA-256 of some bytes as lowercase hexadecimal. */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The attributes of a tag that stay in an extraction: an anchor is how the tests find a section. */
const KEPT_ATTRIBUTES = new Set(["id"]);

/** The elements whose content is not the text of a specification: scripts, styles, drawings and navigation. */
const DISCARDED_ELEMENTS = /<(script|style|svg|nav)\b[^>]*>[\s\S]*?<\/\1>/gu;

/** An attribute of a tag, with its value in quotes or bare. */
const ATTRIBUTE = /\s+([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gu;

/** A start tag with its attributes, whose values may hold a `>`. */
const START_TAG = /<([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gu;

/**
 * Takes the text of a specification from a page of the open portal of 1EdTech: the content of its innermost `main` element, which
 * holds the document and not the sidebar around it, without scripts, styles, drawings and navigation, and with every attribute but
 * `id` taken off its tags, so that the links, the classes and the identifiers of style that the site changes do not change it.
 * The white space is the page's, because the examples in `pre` elements are read by their lines.
 *
 * @param html - The page.
 * @returns The text of the specification, in the markup of the page.
 * @throws `Error` when the page has no `main` element.
 */
export function extractPortalPage(html: string): string {
  const open = html.lastIndexOf("<main");
  if (open < 0) throw new Error("The page has no main element, which holds the specification.");
  const start = html.indexOf(">", open) + 1;
  const end = html.indexOf("</main>", start);
  const content = html
    .slice(start, end < 0 ? html.length : end)
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(DISCARDED_ELEMENTS, "");
  return content
    .replace(START_TAG, (_, name: string, attributes: string, closing: string) => {
      const kept = [...attributes.matchAll(ATTRIBUTE)]
        .filter(([, attribute]) => KEPT_ATTRIBUTES.has((attribute ?? "").toLowerCase()))
        .map(([attribute]) => attribute);
      return `<${name}${kept.join("")}${closing}>`;
    })
    .replaceAll("\r\n", "\n")
    .trim();
}

/** Turns the bytes of a download into the bytes of the file that is pinned: the download itself, or its extraction. */
export function pinnedBytes(schema: SchemaFile, download: Uint8Array): Uint8Array {
  if (schema.extract === undefined) return download;
  return new TextEncoder().encode(extractPortalPage(new TextDecoder().decode(download)));
}

/** Runs a function on every item, a few at a time, and returns the results in order. */
export async function mapConcurrently<T, TResult>(
  items: readonly T[],
  run: (item: T) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) results[index] = await run(items[index] as T);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

/** Returns whether the file is in the directory with its pinned hash. */
async function isCurrent(directory: string, schema: SchemaFile): Promise<boolean> {
  try {
    return sha256(await readFile(join(directory, schema.file))) === schema.sha256;
  } catch {
    // A file that is missing or cannot be read is downloaded again.
    return false;
  }
}

/** Downloads a file and writes it when its hash is the pinned one; returns why it did not. */
async function fetchOne(directory: string, schema: SchemaFile): Promise<string | undefined> {
  try {
    const bytes = pinnedBytes(schema, await downloadBytes(schema.url));
    const hash = sha256(bytes);
    if (hash !== schema.sha256) return `${schema.url} has the SHA-256 ${hash}, not the pinned ${schema.sha256}.`;
    await writeFile(join(directory, schema.file), bytes);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Reads the list of pinned files. */
export function loadList(root: string): SchemaFile[] {
  return JSON.parse(readFileSync(join(root, LIST_PATH), "utf8"));
}

/** Returns the directory the files are downloaded to. */
export function schemaDirectory(root: string): string {
  return join(root, CACHE_PATH);
}

/**
 * Returns the directory for tests that read the downloaded files.
 *
 * @throws `Error` when the files are not downloaded.
 */
export function requireSchemas(root: string): string {
  const directory = schemaDirectory(root);
  if (!existsSync(directory))
    throw new Error(`The schemas are not downloaded to ${directory}: run pnpm schemas first.`);
  return directory;
}

/**
 * Downloads the files that are not in the directory with their pinned hashes, and writes a file only when the bytes it
 * got have the pinned hash. A failed download does not stop the others, so that running it again completes the set.
 *
 * @returns The names of the files it downloaded.
 * @throws `Error` when a download fails or differs from its pinned hash; that file is not written.
 */
export async function downloadSchemas(root: string): Promise<string[]> {
  const directory = schemaDirectory(root);
  const schemas = loadList(root);
  await mkdir(directory, { recursive: true });
  const current = await mapConcurrently(schemas, (schema) => isCurrent(directory, schema));
  const missing = schemas.filter((_, index) => !current[index]);
  const reasons = await mapConcurrently(missing, (schema) => fetchOne(directory, schema));
  const failures = reasons.filter((reason) => reason !== undefined);
  if (failures.length > 0) {
    const list = failures.map((reason) => `\n- ${reason}`).join("");
    throw new Error(`Not every schema could be downloaded:${list}\nRun pnpm schemas:pin if a schema changed.`);
  }
  return missing.map((schema) => schema.file);
}

/** Downloads every file and writes its SHA-256 into the list. */
export async function pinSchemas(root: string): Promise<void> {
  const list = loadList(root);
  const hashes = await mapConcurrently(list, async (schema) =>
    sha256(pinnedBytes(schema, await downloadBytes(schema.url))),
  );
  const pinned = list.map((schema, index) => ({ ...schema, sha256: hashes[index] }));
  writeFileSync(join(root, LIST_PATH), `${JSON.stringify(pinned, null, 2)}\n`);
  console.log(`Pinned ${pinned.length} schemas.`);
}

async function main(args: readonly string[]): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const [command] = args;
  if (command === "fetch") {
    const downloaded = await downloadSchemas(root);
    console.log(downloaded.length === 0 ? "The schemas are current." : `Downloaded ${downloaded.length} schemas.`);
  } else if (command === "pin") {
    await pinSchemas(root);
  } else {
    throw new Error("Usage: node scripts/schemas.ts fetch | pin");
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
