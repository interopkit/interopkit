import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadList, schemaDirectory } from "../../../scripts/schemas.js";
import { KNOWN_CONTEXTS } from "../src/data-integrity/index.js";

const ROOT = resolve(import.meta.dirname, "../../..");

/** The contexts as the downloaded files hold them: every address of `KNOWN_CONTEXTS`, which `pnpm schemas` downloads at its pin. */
export function downloadedContexts(): ReadonlyMap<string, unknown> {
  const files = new Map(loadList(ROOT).map(({ url, file }) => [url, file]));
  return new Map(
    [...KNOWN_CONTEXTS.keys()].map((url) => {
      const file = files.get(url);
      if (file === undefined) throw new Error(`${url} is not in the list of downloads.`);
      return [url, JSON.parse(readFileSync(resolve(schemaDirectory(ROOT), file), "utf8"))] as const;
    }),
  );
}

/** Reads a file that `pnpm schemas` downloads, by the address it comes from. */
export function downloadedFile(url: string): string {
  const entry = loadList(ROOT).find((each) => each.url === url);
  if (entry === undefined) throw new Error(`${url} is not in the list of downloads.`);
  return readFileSync(resolve(schemaDirectory(ROOT), entry.file), "utf8");
}
