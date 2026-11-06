import { type CallOptions, type Clock, createKeyedCache, DEFAULT_TIMEOUT_MS, type Fetch } from "@interopkit/core";
import {
  checkNonEmptyString,
  guardSchema,
  MAX_JSON_TOKENS,
  parseWith,
  positiveIntegerSchema,
  readCallOptions,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { KEY_RELATIONSHIPS, type KeyResolver, type VerificationKey } from "../model/index.js";
import { optionsOf } from "../option-schemas.js";
import { type DidResolver, didKeyResolver, didWebResolver } from "./did.js";
import { decodeDidJwk, isDidJwk } from "./did-jwk.js";
import { type DocumentSettings, documentUrl, fetchDocument, isAbsent, keysOfDocument } from "./documents.js";

/** A DID method that a resolver reads itself: `key` and `web`. */
export type DidMethod = "key" | "web";

/** The DID methods that a resolver reads itself. */
const DID_METHODS = ["key", "web"] as const satisfies readonly DidMethod[];

/** What `createKeyResolver` needs. */
export interface KeyResolverOptions {
  /**
   * Gives the time that cached documents expire by.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /**
   * The `fetch` that gets documents. Without it, nothing is fetched: an HTTPS address and a `did:web` do not resolve.
   *
   * @defaultValue none
   */
  readonly fetch?: Fetch;
  /**
   * The DID methods that the resolver reads itself.
   *
   * @defaultValue `["key", "web"]`
   */
  readonly methods?: readonly DidMethod[];
  /**
   * Resolves a verification method of another DID method. The resolver calls it for a DID that no enabled method reads.
   *
   * @defaultValue none
   */
  readonly resolve?: KeyResolver["resolve"];
  /**
   * How long a document stays in the cache, in seconds.
   *
   * @defaultValue `3600`
   */
  readonly ttlSeconds?: number;
  /**
   * The time that a fetch may take, in milliseconds.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
  /**
   * The most bytes of a document.
   *
   * @defaultValue `65536`
   */
  readonly maxBytes?: number;
  /**
   * The most tokens of JSON in a document: the memory of a parse grows with the tokens and not with the bytes. A document over
   * the limit holds no key.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
}

/** How long a document stays in the cache unless the host says otherwise, in seconds. */
const DEFAULT_TTL_SECONDS = 3600;

/** The most bytes of a document unless the host says otherwise: a key set or a DID document is a few kilobytes. */
const DEFAULT_MAX_BYTES = 65_536;

/** The least time between two fetches of one document for a key that it lacks, in milliseconds: a rotation is followed, an invented `kid` cannot flood the issuer. */
const REFETCH_AFTER_MILLISECONDS = 60_000;

/** The most documents that the cache holds. */
const MAX_CACHED_DOCUMENTS = 1000;

const MILLISECONDS_PER_SECOND = 1000;

/** The path of the JWK Set of a domain (Implementation Guide 3.1.12.2). */
const JWK_SET_PATH = "/.well-known/jwks.json";

/**
 * Tells whether the answer to the JWK Set of a domain says that the domain publishes none: a redirect or a refusal. The path is
 * asked of every HTTPS issuer, and a site that has no such file redirects to a page or refuses (a store of files answers 403 for
 * a name that it lacks) as often as it answers 404; only a server that fails or does not answer leaves the keys unknown.
 */
function publishesNoSet(status: number): boolean {
  return status >= 300 && status < 500;
}

const optionsSchema = strictRecord({
  methods: v.optional(v.array(v.picklist(DID_METHODS))),
  resolve: v.optional(
    guardSchema((value): value is KeyResolver["resolve"] => typeof value === "function", "a function"),
  ),
  ttlSeconds: v.optional(positiveIntegerSchema),
  ...optionsOf("clock", "fetch", "timeoutMs", "maxBytes", "maxTokens"),
});

/** Splits a DID URL into the DID and the fragment, or returns `undefined` for a value that is not a DID URL of one method. */
function splitDid(reference: string): { readonly did: string; readonly method: string } | undefined {
  const match = /^(did:([a-z0-9]+):[^#?/]+)(?:#.*)?$/u.exec(reference);
  return match?.[1] === undefined || match[2] === undefined ? undefined : { did: match[1], method: match[2] };
}

/**
 * Makes a resolver of the keys that verify credentials: the keys that a verification method or a `kid` names, and the keys
 * that an issuer publishes.
 *
 * @remarks
 * A verification method resolves from a `did:key`, a `did:web` or an HTTPS address whose document is a JWK, a Multikey, a
 * JWK Set, or a DID document or controller document that lists verification methods. The documents are cached for
 * `ttlSeconds`, with a load shared by the callers that wait for it. A key that a cached document lacks fetches the document
 * again at most once a minute, so that a rotation is followed and an invented `kid` cannot make the resolver fetch on every
 * call. Every fetch goes through the host's `fetch` over HTTPS, without redirects, within `timeoutMs` and `maxBytes`; a host
 * whose addresses come from a counterparty passes a `fetch` that refuses private addresses.
 *
 * @param options - The clock, the `fetch` and the lifetimes.
 * @returns The resolver.
 * @throws `DataError` when an option is not valid.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/impl/ | Open Badges 3.0 Implementation Guide, 3.1.12}
 *
 * @example
 * ```ts
 * import { createKeyResolver, verifyIssuerKey } from "@interopkit/achievement-credentials/keys";
 *
 * const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
 * const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
 * const issuer = "https://example.edu/issuers/1";
 * const document = {
 *   id: issuer,
 *   verificationMethod: [{ id: `${issuer}#key-1`, type: "JsonWebKey", controller: issuer, publicKeyJwk }],
 *   assertionMethod: [`${issuer}#key-1`],
 * };
 * const keys = createKeyResolver({
 *   clock: { now: () => 0 },
 *   fetch: async (url) =>
 *     new Response(url === issuer ? JSON.stringify(document) : "", { status: url === issuer ? 200 : 404 }),
 * });
 * const key = await keys.resolve(`${issuer}#key-1`);
 * if (key === undefined) throw new Error("The key is published.");
 * key.controller; // => "https://example.edu/issuers/1"
 * key.relationships; // => ["assertionMethod"]
 * (await verifyIssuerKey(key, issuer, { keys })).outcome; // => "passed"
 * ```
 */
export function createKeyResolver(options: KeyResolverOptions): KeyResolver {
  const checked = parseWith(optionsSchema, options, "The options of createKeyResolver");
  const { clock, fetch, resolve: otherMethods, ttlSeconds = DEFAULT_TTL_SECONDS } = checked;
  const methods: readonly DidMethod[] = checked.methods ?? DID_METHODS;
  const settings: DocumentSettings | undefined =
    fetch === undefined
      ? undefined
      : {
          fetch,
          timeoutMs: checked.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBytes: checked.maxBytes ?? DEFAULT_MAX_BYTES,
          maxTokens: checked.maxTokens ?? MAX_JSON_TOKENS,
        };
  const resolvers = new Map<string, DidResolver>();
  if (methods.includes("key")) resolvers.set("key", didKeyResolver());
  if (methods.includes("web") && settings !== undefined) resolvers.set("web", didWebResolver(settings));
  const cache = createKeyedCache<readonly VerificationKey[] | undefined>({
    clock,
    lifetime: () => ttlSeconds * MILLISECONDS_PER_SECOND,
    maxEntries: MAX_CACHED_DOCUMENTS,
  });

  /** Loads the keys that the document at a DID or an address holds; `absent` tells the statuses that mean no document. */
  const load = async (
    base: string,
    did: string | undefined,
    absent: (status: number) => boolean,
  ): Promise<readonly VerificationKey[] | undefined> => {
    const document =
      did === undefined
        ? settings === undefined
          ? undefined
          : await fetchDocument(settings, base, absent)
        : await resolvers.get(did)?.(base);
    return document === undefined ? undefined : await keysOfDocument(document, base);
  };

  /** Returns the keys of the document at a DID or an address, from the cache. */
  const keysAt = (base: string, callOptions?: CallOptions, reload = false, absent = isAbsent) => {
    const method = splitDid(base)?.method;
    return cache.get(
      base,
      () => load(base, method, absent),
      callOptions,
      reload ? REFETCH_AFTER_MILLISECONDS : undefined,
    );
  };

  /** Finds the base of a reference: the DID, or the address without its fragment. `undefined` when no enabled method reads it. */
  const baseOf = (reference: string): string | undefined => {
    if (reference.startsWith("did:")) {
      const parts = splitDid(reference);
      return parts !== undefined && resolvers.has(parts.method) ? parts.did : undefined;
    }
    return settings === undefined ? undefined : documentUrl(reference);
  };

  return {
    async resolve(verificationMethod, options) {
      checkNonEmptyString(verificationMethod, "The verification method");
      const callOptions = readCallOptions(options);
      const base = baseOf(verificationMethod);
      if (base === undefined) {
        const parts = splitDid(verificationMethod);
        return parts !== undefined && !(methods as readonly string[]).includes(parts.method)
          ? await otherMethods?.(verificationMethod, callOptions)
          : undefined;
      }
      const find = (keys: readonly VerificationKey[] | undefined) =>
        keys?.find((key) => key.id === verificationMethod) ??
        // A reference with no fragment names the only key that its document holds.
        (keys?.length === 1 && !verificationMethod.includes("#") ? keys[0] : undefined);
      return find(await keysAt(base, callOptions)) ?? find(await keysAt(base, callOptions, true));
    },

    async issuerKeys(issuer, options) {
      checkNonEmptyString(issuer, "The issuer");
      const callOptions = readCallOptions(options);
      if (isDidJwk(issuer)) {
        const publicKeyJwk = decodeDidJwk(issuer);
        return publicKeyJwk === undefined
          ? []
          : [{ id: `${issuer}#0`, controller: issuer, publicKeyJwk, relationships: [...KEY_RELATIONSHIPS] }];
      }
      const base = baseOf(issuer);
      if (base === undefined) return [];
      if (issuer.startsWith("did:")) return (await keysAt(base, callOptions)) ?? [];
      const set = new URL(JWK_SET_PATH, base).href;
      const [document, keySet] = await Promise.all([
        keysAt(base, callOptions),
        keysAt(set, callOptions, false, publishesNoSet),
      ]);
      return [...(document ?? []), ...(keySet ?? [])];
    },
  };
}
