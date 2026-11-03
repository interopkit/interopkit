import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { downloadBytes } from "./download.ts";

/** A file that tests read, pinned to the SHA-256 of its bytes. */
export interface SchemaFile {
  /** The address the file is downloaded from. */
  readonly url: string;
  /** The name of the file in the schema directory. */
  readonly file: string;
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
    const bytes = await downloadBytes(schema.url);
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
  const hashes = await mapConcurrently(list, async (schema) => sha256(await downloadBytes(schema.url)));
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
