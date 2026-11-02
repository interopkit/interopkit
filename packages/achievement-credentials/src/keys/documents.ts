import { callService, type Fetch, ServiceError } from "@interopkit/core";
import { isRecord } from "@interopkit/core/checks";
import { parseJsonText } from "../json-text.js";
import { KEY_RELATIONSHIPS, type KeyRelationship, type VerificationKey } from "../model/index.js";
import { publicJwk, thumbprintOf } from "./jwk.js";
import { jwkOfMultibase } from "./multibase.js";

/** What a fetch of a document needs. */
export interface DocumentSettings {
  /** The `fetch` of the host. */
  readonly fetch: Fetch;
  /** The time that a fetch may take, in milliseconds. */
  readonly timeoutMs: number;
  /** The most bytes of a document. */
  readonly maxBytes: number;
  /** The most tokens of JSON in a document. */
  readonly maxTokens: number;
}

/** The most levels that a document nests: a DID document or a key set is a few levels deep. */
const MAX_DOCUMENT_DEPTH = 16;

/** The most keys that a document may list. A document that lists more is read as publishing none, so that it costs no more than this. */
const MAX_DOCUMENT_KEYS = 100;

/** The statuses that mean that a document is not there, as against a server that failed. */
const ABSENT_STATUSES: readonly number[] = [404, 410];

const ACCEPT = "application/json, application/did+json;q=0.9, application/ld+json;q=0.8";

/** Parses the text of a document, or returns `undefined` when it is not a JSON object within the limits of levels and tokens. */
function parseDocument(text: string, maxTokens: number): Readonly<Record<string, unknown>> | undefined {
  // The tokens and the levels are counted before the parser builds anything.
  const parsed = parseJsonText(text, { maxDepth: MAX_DOCUMENT_DEPTH, maxTokens }, "The document");
  return "value" in parsed && isRecord(parsed.value) ? parsed.value : undefined;
}

/** Returns the address of a document with no fragment, or `undefined` when it is not an HTTPS address that names a host and no user. */
export function documentUrl(reference: string): string | undefined {
  try {
    const url = new URL(reference);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hostname === "") {
      return undefined;
    }
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * Fetches a JSON document by an HTTPS address.
 *
 * @returns The document, or `undefined` when the address is not HTTPS, the server says that the document is not there (404 or
 * 410) or the body is not a JSON object within the depth limit.
 * @throws `ServiceError` when the server did not answer, answered with a redirect or another status, or sent more than
 * `maxBytes`.
 */
export async function fetchDocument(
  settings: DocumentSettings,
  url: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const address = documentUrl(url);
  if (address === undefined) return undefined;
  try {
    const text = await callService(
      { fetch: settings.fetch, timeoutMs: settings.timeoutMs },
      `The document at ${address}`,
      address,
      { method: "GET", headers: { accept: ACCEPT } },
      { maxBytes: settings.maxBytes },
    );
    return parseDocument(text, settings.maxTokens);
  } catch (error) {
    if (error instanceof ServiceError && ABSENT_STATUSES.includes(error.status)) return undefined;
    throw error;
  }
}

/** Resolves a reference of a document against its own identifier: `#key-1` is the key of the document. */
function absolute(reference: string, base: string): string {
  return reference.startsWith("#") ? `${base}${reference}` : reference;
}

/** The relationships under which a document lists its keys, by the identifier of each. */
function relationshipsOf(document: Readonly<Record<string, unknown>>, base: string) {
  const listed = new Map<string, Set<KeyRelationship>>();
  const embedded: Readonly<Record<string, unknown>>[] = [];
  for (const relationship of KEY_RELATIONSHIPS) {
    const entries = document[relationship];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries.slice(0, MAX_DOCUMENT_KEYS + 1)) {
      const reference = isRecord(entry) ? entry.id : entry;
      if (typeof reference !== "string") continue;
      if (isRecord(entry)) embedded.push(entry);
      const id = absolute(reference, base);
      const set = listed.get(id) ?? new Set<KeyRelationship>();
      set.add(relationship);
      listed.set(id, set);
    }
  }
  return { listed, embedded };
}

/** Reads the public key of a verification method: its `publicKeyJwk`, else its `publicKeyMultibase`. */
async function keyOfMethod(method: Readonly<Record<string, unknown>>): Promise<JsonWebKey | undefined> {
  return publicJwk(method.publicKeyJwk) ?? (await jwkOfMultibase(method.publicKeyMultibase));
}

/** Reads the keys of a document that lists verification methods: a DID document or the controller document of an issuer. */
async function keysOfController(
  document: Readonly<Record<string, unknown>>,
  base: string,
): Promise<readonly VerificationKey[]> {
  const { listed, embedded } = relationshipsOf(document, base);
  const methods = Array.isArray(document.verificationMethod) ? document.verificationMethod : [];
  const candidates = [...methods.slice(0, MAX_DOCUMENT_KEYS + 1), ...embedded].filter(isRecord);
  if (candidates.length > MAX_DOCUMENT_KEYS) return [];
  const keys = new Map<string, VerificationKey>();
  for (const method of candidates) {
    if (typeof method.id !== "string") continue;
    const id = absolute(method.id, base);
    if (keys.has(id)) continue;
    const publicKeyJwk = await keyOfMethod(method);
    if (publicKeyJwk === undefined) continue;
    keys.set(id, {
      id,
      controller: typeof method.controller === "string" ? absolute(method.controller, base) : base,
      publicKeyJwk,
      relationships: KEY_RELATIONSHIPS.filter((relationship) => listed.get(id)?.has(relationship)),
    });
  }
  return [...keys.values()];
}

/** Reads the keys of a JWK Set: the keys that an issuer signs credentials with, each under `assertionMethod`. */
async function keysOfSet(members: readonly unknown[], base: string): Promise<readonly VerificationKey[]> {
  if (members.length > MAX_DOCUMENT_KEYS) return [];
  const keys: VerificationKey[] = [];
  for (const member of members) {
    const publicKeyJwk = publicJwk(member);
    if (publicKeyJwk === undefined || !isRecord(member)) continue;
    const name = typeof member.kid === "string" && member.kid !== "" ? member.kid : await thumbprintOf(publicKeyJwk);
    keys.push({
      id: `${base}#${name}`,
      ...(typeof member.iss === "string" ? { iss: member.iss } : {}),
      publicKeyJwk,
      relationships: ["assertionMethod"],
    });
  }
  return keys;
}

/**
 * Reads the keys that a document holds, whatever its kind: a JWK Set, a bare JWK, a Multikey, or a DID document or
 * controller document that lists verification methods.
 *
 * @remarks
 * A document that lists methods or holds a Multikey names the address it was fetched from in its `id`, or it holds no keys:
 * only the server of the address can claim that identifier. Nothing in a document is trusted for who controls a key beyond
 * that, because binding compares what an issuer publishes with the key.
 *
 * @param document - The parsed document.
 * @param base - The address or DID that it was fetched from, without a fragment.
 * @returns The keys, in the order of the document.
 */
export async function keysOfDocument(
  document: Readonly<Record<string, unknown>>,
  base: string,
): Promise<readonly VerificationKey[]> {
  if (Array.isArray(document.keys)) return await keysOfSet(document.keys, base);
  const bare = publicJwk(document);
  if (bare !== undefined) return [{ id: base, publicKeyJwk: bare, relationships: [] }];
  if (document.id !== base) return [];
  if (typeof document.publicKeyMultibase === "string" || isRecord(document.publicKeyJwk)) {
    const publicKeyJwk = await keyOfMethod(document);
    if (publicKeyJwk === undefined) return [];
    return [
      {
        id: base,
        ...(typeof document.controller === "string" ? { controller: document.controller } : {}),
        publicKeyJwk,
        relationships: [],
      },
    ];
  }
  return await keysOfController(document, base);
}
