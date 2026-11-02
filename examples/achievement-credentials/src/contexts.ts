import type { ContextLoader } from "@interopkit/achievement-credentials";
import { createContextLoader } from "@interopkit/achievement-credentials/data-integrity";

/** The contexts that a credential of Open Badges 3.0 with a Data Integrity proof names. */
const ADDRESSES = [
  "https://www.w3.org/ns/credentials/v2",
  "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  "https://purl.imsglobal.org/spec/ob/v3p0/extensions.json",
  "https://w3id.org/security/data-integrity/v2",
] as const;

/**
 * A context that maps every term into one vocabulary, as the contexts of credentials do for what they do not define. It is
 * written in canonical JSON (members in order, no white space), which is what a pin hashes.
 */
const STAND_IN = '{"@context":{"@version":1.1,"@vocab":"https://example.edu/vocab#","id":"@id","type":"@type"}}';

/**
 * Makes a loader of contexts that serves a small stand-in for each context of a credential, pinned like the real ones. A host
 * serves the real documents, at the pins of `KNOWN_CONTEXTS`, and never loads a context from the credential itself; the
 * example stands in small ones so that it needs no download and runs on every runtime.
 */
export async function createStandInContexts(): Promise<ContextLoader> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(STAND_IN));
  const pin = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return createContextLoader({
    documents: new Map(ADDRESSES.map((address) => [address, JSON.parse(STAND_IN)])),
    pins: new Map(ADDRESSES.map((address) => [address, pin])),
  });
}
