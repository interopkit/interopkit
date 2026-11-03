import {
  type CallOptions,
  callService,
  DataError,
  DEFAULT_TIMEOUT_MS,
  type Fetch,
  raceAbort,
  ServiceError,
} from "@interopkit/core";
import {
  checkFunction,
  checkHttpsUrl,
  checkPositiveInteger,
  checkRecord,
  describe,
  MAX_JSON_DEPTH,
  MAX_JSON_TOKENS,
} from "@interopkit/core/checks";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { parseJsonText } from "../json-text.js";
import type { ContextLoader } from "../model/index.js";
import { canonicalJson } from "./canonical-json.js";

/**
 * The contexts that credentials and their proofs name, by address, with the SHA-256 of each document as lower-case
 * hexadecimal over its canonical JSON.
 *
 * @remarks
 * They are the Verifiable Credentials contexts of the two data models, Open Badges 3.0.0 to 3.0.3 with its extensions, CLR
 * 2.0.0 and 2.0.1, Data Integrity 2, Multikey, DID, and the context of the legacy `Ed25519Signature2020`. A test reads the
 * documents at pinned hashes and checks every entry.
 */
export const KNOWN_CONTEXTS: ReadonlyMap<string, string> = new Map([
  ["https://www.w3.org/ns/credentials/v2", "b463c8d6a066214123ddd9827b135e1b50e1fc73322cc52a9b12a4f1fc7d86cf"],
  ["https://www.w3.org/2018/credentials/v1", "b01e671e873981f19a9102a9a57f666dbcaeb31b99e3e124378d143e71549247"],
  [
    "https://purl.imsglobal.org/spec/ob/v3p0/context.json",
    "2c54acaa1cffda2420be32ab61f0a2082051211131c6337686f36f2537aa859b",
  ],
  [
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.1.json",
    "8bb2354552b70cbdf2066f6d3e24bc5c2be2619145737580ad2aebdc366e77d5",
  ],
  [
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.2.json",
    "bdd1d11a55a660322f24660862a1d430ee80cce584465f750909daa43684357c",
  ],
  [
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
    "04b1136ddc4eda9a8966bc7ef182789f233a26739473140ef75d6968c29a2966",
  ],
  [
    "https://purl.imsglobal.org/spec/ob/v3p0/extensions.json",
    "15f4c347c6fe4380d9b6b93795859e33747ef48d5c55b91a71c52fb51c7bcbd7",
  ],
  [
    "https://purl.imsglobal.org/spec/clr/v2p0/context.json",
    "a2dd0c0c07434663b7b54a51dd8a3363f6d5c420efa87e3d97b4ef8661596d44",
  ],
  [
    "https://purl.imsglobal.org/spec/clr/v2p0/context-2.0.1.json",
    "7defe702c102faf14108579b7d65ef39ecf4c3bbef925b803e15bd77cd6e3394",
  ],
  ["https://w3id.org/security/data-integrity/v2", "7ba3c50acf2689d5e07927267343eb353249c7c22a9f2d00307cc970e855e305"],
  ["https://w3id.org/security/multikey/v1", "be20c3ee6af6e9c4102e66a85c26617831218e32216bdf050f870e389e737cdc"],
  ["https://www.w3.org/ns/did/v1", "a7e146c40fcec005d3f0f14ae745665f446da58d7914a9d8f733746686fad82b"],
  [
    "https://w3id.org/security/suites/ed25519-2020/v1",
    "fb517f09d990829aed734c9bad8cbbb2ac3d5063b865c7e3d81f246074bf5691",
  ],
]);

/** A cache of contexts that a host keeps between processes. */
export interface ContextCache {
  /** Returns the document kept for an address, or `undefined` when it holds none. */
  get(url: string): Promise<unknown>;
  /** Keeps the document of an address, after it was checked against its pin. */
  put(url: string, document: unknown): Promise<void>;
}

/** What `createContextLoader` needs. */
export interface ContextLoaderOptions {
  /**
   * The `fetch` that gets a context the loader does not hold. Without it, only `documents` and `cache` are served.
   *
   * @defaultValue none
   */
  readonly fetch?: Fetch;
  /**
   * Contexts that the host already holds, by address. Each is checked against its pin like a fetched one.
   *
   * @defaultValue none
   */
  readonly documents?: ReadonlyMap<string, unknown>;
  /**
   * More pins: an address and the SHA-256 of its document over its canonical JSON, as lower-case hexadecimal, for the contexts
   * of an extension.
   *
   * @defaultValue none
   */
  readonly pins?: ReadonlyMap<string, string>;
  /**
   * A cache of the host that keeps verified contexts between processes. A context read from it is checked against its pin
   * again.
   *
   * @defaultValue none
   */
  readonly cache?: ContextCache;
  /**
   * Serve a context that has no pin.
   *
   * @defaultValue `false`
   */
  readonly allowUnknown?: boolean;
  /**
   * The time that a fetch may take, in milliseconds.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
  /**
   * The most bytes of a context.
   *
   * @defaultValue `262144`
   */
  readonly maxBytes?: number;
  /**
   * The most tokens of JSON in a context: the memory of a parse grows with the tokens and not with the bytes.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
}

/** The most bytes of a context unless the host says otherwise: the largest, Open Badges, is under 15,000. */
const DEFAULT_MAX_BYTES = 262_144;

/** The most contexts that a loader keeps in memory. */
const MAX_KEPT_CONTEXTS = 100;

/** The SHA-256 of the canonical JSON of a document, as lower-case hexadecimal. */
export function contextHash(document: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(document))));
}

/** Checks the options of `createContextLoader` as a host passes them from JavaScript. */
function checkOptions(options: unknown): asserts options is ContextLoaderOptions {
  checkRecord(options, "The options of createContextLoader must be an object");
  if (options.fetch !== undefined) checkFunction(options.fetch, "The option fetch must be a function");
  for (const name of ["documents", "pins"] as const) {
    const value = options[name];
    if (value !== undefined && !(value instanceof Map)) {
      throw new DataError(`The option ${name} must be a Map, found ${describe(value)}.`);
    }
  }
  if (options.cache !== undefined) {
    checkRecord(options.cache, "The option cache must be an object");
    checkFunction(options.cache.get, "The function get of the option cache must be a function");
    checkFunction(options.cache.put, "The function put of the option cache must be a function");
  }
  if (options.allowUnknown !== undefined && typeof options.allowUnknown !== "boolean") {
    throw new DataError(`The option allowUnknown must be true or false, found ${describe(options.allowUnknown)}.`);
  }
  if (options.timeoutMs !== undefined) checkPositiveInteger(options.timeoutMs, "The option timeoutMs");
  if (options.maxBytes !== undefined) checkPositiveInteger(options.maxBytes, "The option maxBytes");
  if (options.maxTokens !== undefined) checkPositiveInteger(options.maxTokens, "The option maxTokens");
}

/**
 * Makes the loader of the contexts of JSON-LD: it serves a context only after its document matches the SHA-256 that is pinned
 * for its address.
 *
 * @remarks
 * A context comes from `documents`, then `cache`, then a fetch of the address through the host's `fetch`. Whatever its source,
 * its canonical JSON must hash to the pin of `KNOWN_CONTEXTS` or of `pins`; a context with no pin is refused unless
 * `allowUnknown` is set, and a context whose document differs from its pin is always refused, never processed. A verified
 * context is kept in memory and shared by the callers that ask while it loads. Each call returns a copy. W3C asks that its
 * contexts are not fetched on every request: a host passes them in `documents`, or keeps them in `cache`.
 *
 * @param options - The `fetch`, the contexts the host holds, more pins and the limits.
 * @returns The loader.
 * @throws `DataError` when an option is not valid, or, when the loader is called, for a context that is not pinned, does not
 * match its pin, is not a JSON object within the depth limit or is held by no source.
 * @throws `ServiceError` when a fetch fails.
 * @see {@link https://www.w3.org/TR/vc-data-model-2.0/#contexts | Verifiable Credentials Data Model 2.0, contexts}
 */
export function createContextLoader(options: ContextLoaderOptions): ContextLoader {
  checkOptions(options);
  const { fetch, documents, pins, cache: hostCache, allowUnknown = false } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxTokens = options.maxTokens ?? MAX_JSON_TOKENS;
  // A context at a pinned address is the same document for the life of the loader, so a load is kept as it is, and shared.
  const kept = new Map<string, Promise<unknown>>();

  /** Refuses an address that has no pin before anything is read or fetched for it, unless the host allows unknown contexts. */
  const pinOf = (url: string): string | undefined => {
    const pin = pins?.get(url) ?? KNOWN_CONTEXTS.get(url);
    if (pin === undefined && !allowUnknown) {
      throw new DataError(
        `The context ${url} has no pin, so it is not loaded: pin it in the option pins or set allowUnknown.`,
      );
    }
    return pin;
  };

  /** Refuses a document that does not hash to the pin of its address. */
  const check = (url: string, document: unknown): unknown => {
    const pin = pinOf(url);
    if (pin !== undefined && contextHash(document) !== pin) {
      throw new DataError(`The context ${url} is not the document that is pinned for it, so it is not loaded.`);
    }
    return document;
  };

  /** Gets the document of a context from the host's sources, in order, and returns it verified. */
  const load = async (url: string): Promise<unknown> => {
    pinOf(url);
    const held = documents?.get(url) ?? (await hostCache?.get(url));
    if (held !== undefined) return check(url, held);
    if (fetch === undefined)
      throw new DataError(`The context ${url} is held by no source: pass it in documents, or pass a fetch.`);
    const text = await callService(
      { fetch, timeoutMs },
      `The context ${url}`,
      url,
      { method: "GET", headers: { accept: "application/ld+json, application/json" } },
      { maxBytes },
    );
    const parsed = parseJsonText(text, { maxDepth: MAX_JSON_DEPTH, maxTokens }, `The context ${url}`);
    if ("reason" in parsed) {
      if (parsed.overLimit) throw new DataError(parsed.reason);
      throw new ServiceError(parsed.reason, 200, text.slice(0, 256));
    }
    check(url, parsed.value);
    await hostCache?.put(url, parsed.value);
    return parsed.value;
  };

  /** Returns the load of a context: the kept one, or a new one that is forgotten if it fails. */
  const loadOnce = (url: string): Promise<unknown> => {
    const earlier = kept.get(url);
    if (earlier !== undefined) return earlier;
    const started = load(url);
    kept.set(url, started);
    started.catch(() => kept.delete(url));
    for (const oldest of kept.keys()) {
      if (kept.size <= MAX_KEPT_CONTEXTS) break;
      kept.delete(oldest);
    }
    return started;
  };

  return async (url: string, callOptions?: CallOptions) => {
    checkHttpsUrl(url, "The address of a context");
    return structuredClone(await raceAbort(loadOnce(url), callOptions?.signal));
  };
}
