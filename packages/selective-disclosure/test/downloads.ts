import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadList, schemaDirectory } from "../../../scripts/schemas.js";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import type { JsonDocument } from "../src/index.js";

const ROOT = resolve(import.meta.dirname, "../../..");

/** A key pair as the Recommendation prints it. */
interface PrintedKeyPair {
  readonly publicKeyMultibase: string;
  readonly secretKeyMultibase: string;
}

/** The blocks of one example of the Recommendation, by what they show. */
export interface Vector {
  readonly baseKeyPair: PrintedKeyPair;
  readonly proofKeyPair: PrintedKeyPair;
  readonly hmacKeyString: string;
  /** The credential without a proof. */
  readonly unsecured: JsonDocument;
  readonly mandatoryPointers: readonly string[];
  /** The credential with its base proof. */
  readonly signed: JsonDocument;
  /** The components of the base proof value. */
  readonly baseComponents: {
    readonly baseSignature: string;
    readonly publicKey: string;
    readonly signatures: readonly string[];
    readonly mandatoryPointers: readonly string[];
  };
  readonly selectivePointers: readonly string[];
  /** The components of the derived proof value. */
  readonly derivedComponents: {
    readonly baseSignature: string;
    readonly publicKey: string;
    readonly signatures: readonly string[];
    readonly labelMap: { readonly value: readonly (readonly [string, string])[] };
    readonly mandatoryIndexes: readonly number[];
  };
  /** The revealed credential with its derived proof. */
  readonly derived: JsonDocument;
}

/**
 * Reads the two examples of `ecdsa-sd-2023` from the JSON that the Recommendation prints (appendix A.7 and A.8). The page is
 * downloaded at a pinned hash, so the order of its JSON blocks is fixed: each example starts at the block with the key pairs
 * and holds the blocks below, in the order of the page.
 */
export function readVectors(): readonly Vector[] {
  const blocks = readSpecPage(ROOT, "vc-di-ecdsa-1p0.json");
  const starts = blocks.flatMap((block, index) =>
    typeof block === "object" && block !== null && "baseKeyPair" in block ? [index] : [],
  );
  return starts.map((start) => {
    const at = (offset: number) => blocks[start + offset] as never;
    const keys = at(0) as { baseKeyPair: PrintedKeyPair; proofKeyPair: PrintedKeyPair; hmacKeyString: string };
    return {
      ...keys,
      unsecured: at(1),
      mandatoryPointers: at(2),
      baseComponents: at(9),
      signed: at(10),
      selectivePointers: at(12),
      derivedComponents: at(17),
      derived: at(18),
    };
  });
}

/** The contexts that the tests read, which `pnpm schemas` downloads at pinned hashes. */
const CONTEXT_URLS: readonly string[] = ["https://www.w3.org/ns/credentials/v2", "https://w3id.org/citizenship/v4rc1"];

/** The downloaded contexts, by URL. */
export function downloadedContexts(): ReadonlyMap<string, unknown> {
  const directory = schemaDirectory(ROOT);
  return new Map(
    loadList(ROOT)
      .filter(({ url }) => CONTEXT_URLS.includes(url))
      .map(({ url, file }) => [url, JSON.parse(readFileSync(resolve(directory, file), "utf8"))]),
  );
}
