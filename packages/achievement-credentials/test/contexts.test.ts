import { createHash } from "node:crypto";
import { DataError, ServiceError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createContextLoader, KNOWN_CONTEXTS } from "../src/data-integrity/index.js";
import { canonicalJson, contextHash } from "../src/data-integrity/internal.js";
import { serve } from "./key-fixtures.js";

const ADDRESS = "https://example.test/contexts/a/v1";
const DOCUMENT = { "@context": { "@version": 1.1, name: "https://example.test/vocab#name" } };
const PINS = new Map([[ADDRESS, contextHash(DOCUMENT)]]);

describe("the hash of a context", () => {
  it("is the SHA-256 of its canonical JSON, whatever the order of the members", () => {
    const text = '{"@context":{"@version":1.1,"name":"https://example.test/vocab#name"}}';
    expect(canonicalJson({ "@context": { name: "https://example.test/vocab#name", "@version": 1.1 } })).toBe(text);
    expect(contextHash(DOCUMENT)).toBe(createHash("sha256").update(text).digest("hex"));
  });

  it("does not depend on the order of the members of any object", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const reversed = JSON.parse(JSON.stringify(value), (_name, member) =>
          member !== null && typeof member === "object" && !Array.isArray(member)
            ? Object.fromEntries(Object.entries(member).reverse())
            : member,
        );
        expect(canonicalJson(reversed)).toBe(canonicalJson(value));
      }),
      { seed: 20_241_105, numRuns: 100 },
    );
  });

  it("is pinned for every context that credentials and their proofs name", () => {
    expect([...KNOWN_CONTEXTS.keys()]).toContain("https://www.w3.org/ns/credentials/v2");
    expect([...KNOWN_CONTEXTS.keys()]).toContain("https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json");
    for (const hash of KNOWN_CONTEXTS.values()) expect(hash).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("a context that the host holds", () => {
  it("is served as a copy when it matches its pin", async () => {
    const load = createContextLoader({ documents: new Map([[ADDRESS, DOCUMENT]]), pins: PINS });
    const first = await load(ADDRESS);
    expect(first).toStrictEqual(DOCUMENT);
    expect(first).not.toBe(DOCUMENT);
    expect(await load(ADDRESS)).not.toBe(first);
  });

  it("is refused when it is not the document that is pinned, and never processed", async () => {
    const forged = { "@context": { name: "https://evil.example/name" } };
    const load = createContextLoader({ documents: new Map([[ADDRESS, forged]]), pins: PINS });
    await expect(load(ADDRESS)).rejects.toThrow("not the document that is pinned");
  });

  it("is refused for a known address when its document is another", async () => {
    const address = "https://www.w3.org/ns/credentials/v2";
    const load = createContextLoader({ documents: new Map([[address, DOCUMENT]]) });
    await expect(load(address)).rejects.toThrow("not the document that is pinned");
  });

  it("is refused when it has no pin, unless the host allows unknown contexts", async () => {
    const documents = new Map([[ADDRESS, DOCUMENT]]);
    await expect(createContextLoader({ documents })(ADDRESS)).rejects.toThrow("has no pin");
    expect(await createContextLoader({ documents, allowUnknown: true })(ADDRESS)).toStrictEqual(DOCUMENT);
  });

  it("is refused when nothing holds it and there is no fetch", async () => {
    await expect(createContextLoader({ pins: PINS })(ADDRESS)).rejects.toThrow("held by no source");
  });
});

describe("a context that is fetched", () => {
  const routes = { [ADDRESS]: DOCUMENT };

  it("is fetched once for the callers that ask together, checked against its pin and put into the cache", async () => {
    const { fetch, requests } = serve(routes);
    const put: string[] = [];
    const load = createContextLoader({
      fetch,
      pins: PINS,
      cache: { get: async () => undefined, put: async (url) => void put.push(url) },
    });
    const [first, second] = await Promise.all([load(ADDRESS), load(ADDRESS)]);
    expect(first).toStrictEqual(DOCUMENT);
    expect(second).toStrictEqual(DOCUMENT);
    await load(ADDRESS);
    expect(requests).toStrictEqual([ADDRESS]);
    expect(put).toStrictEqual([ADDRESS]);
  });

  it("is served from the cache of the host without a fetch, and checked again", async () => {
    const { fetch, requests } = serve(routes);
    const cache = { get: async () => structuredClone(DOCUMENT), put: async () => undefined };
    expect(await createContextLoader({ fetch, pins: PINS, cache })(ADDRESS)).toStrictEqual(DOCUMENT);
    expect(requests).toStrictEqual([]);
    const poisoned = { get: async () => ({ "@context": {} }), put: async () => undefined };
    await expect(createContextLoader({ fetch, pins: PINS, cache: poisoned })(ADDRESS)).rejects.toThrow("pinned");
  });

  it("is refused when the fetched document is not the pinned one, and is not put into the cache", async () => {
    const { fetch } = serve({ [ADDRESS]: { "@context": { name: "https://evil.example/name" } } });
    const put: string[] = [];
    const cache = { get: async () => undefined, put: async (url: string) => void put.push(url) };
    await expect(createContextLoader({ fetch, pins: PINS, cache })(ADDRESS)).rejects.toThrow("pinned");
    expect(put).toStrictEqual([]);
  });

  it("is a ServiceError when the fetch fails, and the failure is not kept", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 503 }) : new Response(JSON.stringify(DOCUMENT));
    };
    const load = createContextLoader({ fetch, pins: PINS });
    await expect(load(ADDRESS)).rejects.toBeInstanceOf(ServiceError);
    expect(await load(ADDRESS)).toStrictEqual(DOCUMENT);
  });

  it("is refused above the size limit, as text that is not JSON, and nested too deep", async () => {
    const { fetch } = serve({
      [ADDRESS]: JSON.stringify(DOCUMENT),
      "https://example.test/contexts/b/v1": "<html>",
      "https://example.test/contexts/c/v1": `${"[".repeat(100)}${"]".repeat(100)}`,
    });
    await expect(createContextLoader({ fetch, pins: PINS, maxBytes: 10 })(ADDRESS)).rejects.toBeInstanceOf(
      ServiceError,
    );
    const open = createContextLoader({ fetch, allowUnknown: true });
    await expect(open("https://example.test/contexts/b/v1")).rejects.toBeInstanceOf(ServiceError);
    await expect(open("https://example.test/contexts/c/v1")).rejects.toThrow("nests more than");
  });

  it("is kept in memory up to a bound, the oldest first", async () => {
    const { fetch, requests } = serve({});
    const documents = new Map(Array.from({ length: 101 }, (_, index) => [`https://example.test/c/${index}`, DOCUMENT]));
    const load = createContextLoader({ documents, fetch, allowUnknown: true });
    for (const address of documents.keys()) await load(address);
    await load("https://example.test/c/100");
    expect(requests).toStrictEqual([]);
  });

  it("ends the wait of the caller that aborts, and the fetch goes on for the others", async () => {
    let release: (response: Response) => void = () => undefined;
    const fetch = () => new Promise<Response>((resolve) => (release = resolve));
    const load = createContextLoader({ fetch, pins: PINS });
    const controller = new AbortController();
    const aborted = load(ADDRESS, { signal: controller.signal });
    const patient = load(ADDRESS);
    controller.abort(new Error("stop"));
    await expect(aborted).rejects.toThrow("stop");
    release(new Response(JSON.stringify(DOCUMENT)));
    expect(await patient).toStrictEqual(DOCUMENT);
  });
});

describe("the arguments", () => {
  it.each([
    ["null options", "null"],
    ["a fetch that is not a function", '{"fetch":"x"}'],
    ["documents that are not a Map", '{"documents":{}}'],
    ["pins that are not a Map", '{"pins":[]}'],
    ["a cache without functions", '{"cache":{}}'],
    ["a cache without put", '{"cache":{"get":null}}'],
    ["allowUnknown that is a string", '{"allowUnknown":"yes"}'],
    ["a timeout of 0", '{"timeoutMs":0}'],
    ["a size limit of 1.5", '{"maxBytes":1.5}'],
  ])("are refused for %s", (_name, text) => {
    expect(() => createContextLoader(JSON.parse(text))).toThrow(DataError);
  });

  it("are refused for an address that is not HTTPS", async () => {
    const load = createContextLoader({ documents: new Map(), allowUnknown: true });
    for (const value of ["http://example.test/c", "urn:c", "5", "null"]) {
      await expect(
        load(JSON.parse(JSON.stringify(value === "5" || value === "null" ? JSON.parse(value) : value))),
      ).rejects.toBeInstanceOf(DataError);
    }
  });
});
