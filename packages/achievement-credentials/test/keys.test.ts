import { DataError, ServiceError } from "@interopkit/core";
import { base64url, calculateJwkThumbprint } from "jose";
import { describe, expect, it } from "vitest";
import { createKeyResolver, verifyIssuerKey } from "../src/keys/index.js";
import { publicJwk } from "../src/keys/internal.js";
import { abortsWhileWaiting, hangingPort } from "./hanging-port.js";
import { HOSTILE, neverParsesLarge } from "./hostile.js";
import { clockAt, KEYS, multibase, serve } from "./key-fixtures.js";

const ISSUER = "https://example.edu/issuers/1";
const SET_URL = "https://example.edu/.well-known/jwks.json";

/** The JWK that a document lists for a key: the public members of the test key. */
const member = (key: { publicJwk: JsonWebKey }, extra: object = {}) => ({ ...key.publicJwk, ...extra });

/** The DID document of a `did:web` issuer that lists one key under the given relationships. */
function webDocument(did: string, relationships: readonly string[]) {
  const id = `${did}#key-1`;
  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    verificationMethod: [{ id, type: "Multikey", controller: did, publicKeyMultibase: KEYS.ed25519.multikey }],
    ...Object.fromEntries(relationships.map((relationship) => [relationship, [id]])),
  };
}

describe("a did:key", () => {
  const resolver = createKeyResolver({ clock: clockAt(0) });

  it.each([
    ["Ed25519", KEYS.ed25519],
    ["P-256", KEYS.es256],
    ["P-384", KEYS.es384],
  ])("resolves the %s key that the DID holds, with no request", async (_name, key) => {
    const did = `did:key:${key.multikey}`;
    const resolved = await resolver.resolve(`${did}#${key.multikey}`);
    expect(resolved).toMatchObject({ id: `${did}#${key.multikey}`, controller: did });
    expect(await calculateJwkThumbprint({ ...resolved?.publicKeyJwk })).toBe(
      await calculateJwkThumbprint({ ...key.publicJwk }),
    );
    expect(resolved?.relationships).toContain("assertionMethod");
  });

  it("resolves the bare DID to its only key", async () => {
    const did = `did:key:${KEYS.ed25519.multikey}`;
    expect((await resolver.resolve(did))?.id).toBe(`${did}#${KEYS.ed25519.multikey}`);
  });

  it("publishes the key to the issuer that is the DID", async () => {
    const did = `did:key:${KEYS.es256.multikey}`;
    const published = await resolver.issuerKeys(did);
    expect(published.map((key) => key.controller)).toStrictEqual([did]);
  });

  it("does not resolve a key of a type that no algorithm of the verification uses", async () => {
    // A secp256k1 key: multicodec 0xe7 0x01 and a 33-byte compressed point.
    const odd = multibase(Uint8Array.from([0xe7, 0x01, 0x02, ...new Uint8Array(32).fill(7)]));
    expect(await resolver.resolve(`did:key:${odd}#${odd}`)).toBeUndefined();
  });

  it("does not resolve a value that is no key", async () => {
    expect(await resolver.resolve("did:key:z6Mknotakey")).toBeUndefined();
  });
});

describe("a document that lists methods", () => {
  const clock = clockAt(0);
  const method = (id: string, extra: object = {}) => ({
    id,
    controller: ISSUER,
    publicKeyJwk: KEYS.es256.publicJwk,
    ...extra,
  });

  it("is read through embedded methods, once for each identifier, and without what is not a method", async () => {
    const first = `${ISSUER}#a`;
    const document = {
      id: ISSUER,
      verificationMethod: [
        method(first),
        method(first, { publicKeyJwk: KEYS.other.publicJwk }),
        { controller: ISSUER },
        5,
      ],
      assertionMethod: [method(`${ISSUER}#b`), first, 5, null, { type: "Multikey" }],
    };
    const { fetch } = serve({ [ISSUER]: document });
    const published = await createKeyResolver({ clock, fetch }).issuerKeys(ISSUER);
    expect(published.map((key) => [key.id, key.relationships])).toStrictEqual([
      [first, ["assertionMethod"]],
      [`${ISSUER}#b`, ["assertionMethod"]],
    ]);
    expect(published[0]?.publicKeyJwk).toStrictEqual(publicJwk(KEYS.es256.publicJwk));
  });

  it("holds no key when a Multikey at its address is of a type that does not verify, or is no key", async () => {
    const url = "https://example.edu/keys/3";
    const { fetch } = serve({
      [url]: { id: url, type: "Multikey", publicKeyMultibase: "zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUkhx1RKjj" },
      "https://example.edu/keys/4": { id: "https://example.edu/keys/4", publicKeyMultibase: "z6Mk-not-a-key" },
    });
    const resolver = createKeyResolver({ clock, fetch });
    expect(await resolver.resolve(url)).toBeUndefined();
    expect(await resolver.resolve("https://example.edu/keys/4")).toBeUndefined();
  });

  it("does not read a method whose multibase has the header of a key and no key", async () => {
    const methods = ["z6Mk", "zDna", "z82L", `z6Mk${"1".repeat(200)}`, 5].map((publicKeyMultibase, index) =>
      method(`${ISSUER}#k${index}`, { publicKeyJwk: undefined, publicKeyMultibase }),
    );
    const { fetch } = serve({
      [ISSUER]: { id: ISSUER, verificationMethod: methods, assertionMethod: methods.map(({ id }) => id) },
    });
    expect(await createKeyResolver({ clock, fetch }).issuerKeys(ISSUER)).toStrictEqual([]);
  });
});

describe("a did:web", () => {
  it("fetches the document of the DID once, over HTTPS, and reads its key and relationships", async () => {
    const did = "did:web:example.edu:issuers:1";
    const { fetch, requests } = serve({
      "https://example.edu/issuers/1/did.json": webDocument(did, ["assertionMethod", "authentication"]),
    });
    const resolver = createKeyResolver({ clock: clockAt(0), fetch });
    const first = await resolver.resolve(`${did}#key-1`);
    expect(first).toMatchObject({
      id: `${did}#key-1`,
      controller: did,
      relationships: ["assertionMethod", "authentication"],
    });
    await resolver.resolve(`${did}#key-1`);
    await resolver.issuerKeys(did);
    expect(requests).toStrictEqual(["https://example.edu/issuers/1/did.json"]);
  });

  it("reads the key of a method listed by a relative reference", async () => {
    const did = "did:web:example.edu";
    const document = { ...webDocument(did, []), assertionMethod: ["#key-1"] };
    document.verificationMethod = [{ ...document.verificationMethod[0], id: "#key-1" } as never];
    const { fetch } = serve({ "https://example.edu/.well-known/did.json": document });
    const published = await createKeyResolver({ clock: clockAt(0), fetch }).issuerKeys(did);
    expect(published.map((key) => [key.id, key.relationships])).toStrictEqual([[`${did}#key-1`, ["assertionMethod"]]]);
  });

  it("does not resolve a document that names another DID", async () => {
    const { fetch } = serve({
      "https://example.edu/.well-known/did.json": webDocument("did:web:other.example", ["assertionMethod"]),
    });
    const resolver = createKeyResolver({ clock: clockAt(0), fetch });
    expect(await resolver.resolve("did:web:example.edu#key-1")).toBeUndefined();
  });

  it("is a ServiceError when the document cannot be fetched, and is not fetched over HTTP", async () => {
    const down = createKeyResolver({ clock: clockAt(0), fetch: async () => new Response("", { status: 503 }) });
    await expect(down.resolve("did:web:example.edu#key-1")).rejects.toBeInstanceOf(ServiceError);
    const { fetch, requests } = serve({});
    const local = createKeyResolver({ clock: clockAt(0), fetch });
    expect(await local.resolve("did:web:localhost%3A8080#key-1")).toBeUndefined();
    expect(requests).toStrictEqual([]);
  });

  it("does not resolve when no fetch is given, or the method is not enabled", async () => {
    const did = "did:web:example.edu";
    const { fetch, requests } = serve({
      "https://example.edu/.well-known/did.json": webDocument(did, ["assertionMethod"]),
    });
    expect(await createKeyResolver({ clock: clockAt(0) }).resolve(`${did}#key-1`)).toBeUndefined();
    expect(
      await createKeyResolver({ clock: clockAt(0), fetch, methods: ["key"] }).resolve(`${did}#key-1`),
    ).toBeUndefined();
    expect(requests).toStrictEqual([]);
  });

  it("sends a DID of another method to the resolve port", async () => {
    const found = { id: "did:ion:abc#1", publicKeyJwk: KEYS.es256.publicJwk, relationships: [] } as const;
    const calls: string[] = [];
    const resolver = createKeyResolver({
      clock: clockAt(0),
      resolve: async (method) => {
        calls.push(method);
        return found;
      },
    });
    expect(await resolver.resolve("did:ion:abc#1")).toBe(found);
    expect(await resolver.resolve("did:key:z6Mknotakey")).toBeUndefined();
    expect(calls).toStrictEqual(["did:ion:abc#1"]);
  });
});

describe("a key at an HTTPS address", () => {
  const clock = clockAt(0);

  it("resolves a bare JWK, which has no controller", async () => {
    const { fetch } = serve({ "https://example.edu/keys/1": KEYS.rs256.publicJwk });
    const resolved = await createKeyResolver({ clock, fetch }).resolve("https://example.edu/keys/1");
    expect(resolved).toMatchObject({ id: "https://example.edu/keys/1", relationships: [] });
    expect(resolved?.controller).toBeUndefined();
  });

  it("resolves a Multikey that names its own address", async () => {
    const url = "https://example.edu/keys/2";
    const { fetch } = serve({
      [url]: { id: url, type: "Multikey", controller: ISSUER, publicKeyMultibase: KEYS.es256.multikey },
    });
    expect(await createKeyResolver({ clock, fetch }).resolve(url)).toMatchObject({ id: url, controller: ISSUER });
  });

  it("does not resolve a Multikey that names another address", async () => {
    const url = "https://example.edu/keys/2";
    const { fetch } = serve({
      [url]: { id: "https://elsewhere.example/keys/2", type: "Multikey", publicKeyMultibase: KEYS.es256.multikey },
    });
    expect(await createKeyResolver({ clock, fetch }).resolve(url)).toBeUndefined();
  });

  it("resolves a member of a JWK Set by its kid, and keeps the iss of the member", async () => {
    const { fetch } = serve({
      [SET_URL]: { keys: [member(KEYS.es256, { kid: "a", iss: ISSUER }), member(KEYS.ed25519, { kid: "b" })] },
    });
    const resolver = createKeyResolver({ clock, fetch });
    expect(await resolver.resolve(`${SET_URL}#a`)).toMatchObject({ id: `${SET_URL}#a`, iss: ISSUER });
    expect(await resolver.resolve(`${SET_URL}#c`)).toBeUndefined();
  });

  it("lists the keys of a controller document under the relationships that it gives them", async () => {
    const { fetch } = serve({
      [ISSUER]: {
        id: ISSUER,
        verificationMethod: [
          { id: `${ISSUER}#a`, type: "JsonWebKey", controller: ISSUER, publicKeyJwk: KEYS.es256.publicJwk },
          { id: `${ISSUER}#b`, type: "Multikey", controller: ISSUER, publicKeyMultibase: KEYS.es384.multikey },
        ],
        assertionMethod: [`${ISSUER}#a`],
      },
    });
    const published = await createKeyResolver({ clock, fetch }).issuerKeys(ISSUER);
    expect(published.map((key) => [key.id, key.relationships])).toStrictEqual([
      [`${ISSUER}#a`, ["assertionMethod"]],
      [`${ISSUER}#b`, []],
    ]);
  });

  it("does not read the keys of a controller document that names another identifier or none", async () => {
    const methods = [{ id: `${ISSUER}#a`, controller: ISSUER, publicKeyJwk: KEYS.es256.publicJwk }];
    const { fetch } = serve({
      [ISSUER]: {
        id: "https://elsewhere.example/issuers/1",
        verificationMethod: methods,
        assertionMethod: [`${ISSUER}#a`],
      },
      "https://example.edu/issuers/2": { verificationMethod: methods, assertionMethod: [`${ISSUER}#a`] },
    });
    const resolver = createKeyResolver({ clock, fetch });
    expect(await resolver.issuerKeys(ISSUER)).toStrictEqual([]);
    expect(await resolver.issuerKeys("https://example.edu/issuers/2")).toStrictEqual([]);
  });

  it("publishes the keys of the JWK Set of the host beside those of the document of the issuer", async () => {
    const { fetch, requests } = serve({
      [ISSUER]: { id: ISSUER, name: "Example University" },
      [SET_URL]: { keys: [member(KEYS.rs256, { kid: "k" })] },
    });
    const published = await createKeyResolver({ clock, fetch }).issuerKeys(ISSUER);
    expect(published.map((key) => key.id)).toStrictEqual([`${SET_URL}#k`]);
    expect(requests.toSorted()).toStrictEqual([ISSUER, SET_URL].toSorted());
  });

  it("names a key of a set that has no kid by its thumbprint", async () => {
    const { fetch } = serve({ [SET_URL]: { keys: [KEYS.ed25519.publicJwk] } });
    const [key] = await createKeyResolver({ clock, fetch }).issuerKeys(ISSUER);
    expect(key?.id).toBe(`${SET_URL}#${await calculateJwkThumbprint({ ...KEYS.ed25519.publicJwk })}`);
  });

  it("reads the key that a did:jwk issuer is made of, with no request", async () => {
    const did = `did:jwk:${base64url.encode(JSON.stringify(KEYS.es256.publicJwk))}`;
    const { fetch, requests } = serve({});
    const [key] = await createKeyResolver({ clock, fetch }).issuerKeys(did);
    expect(key).toMatchObject({ controller: did });
    expect(key?.relationships).toContain("assertionMethod");
    expect(requests).toStrictEqual([]);
  });

  it("publishes nothing for an issuer that is no address and no DID that it reads", async () => {
    const { fetch } = serve({});
    const resolver = createKeyResolver({ clock, fetch });
    const unreadable = ["urn:uuid:1", "http://example.edu/issuers/1", "did:ion:abc", `did:jwk:${"A".repeat(5000)}`];
    const garbled = [
      "did:jwk:",
      "did:jwk:%%%",
      `did:jwk:${base64url.encode("[[[[[[[")}`,
      `did:jwk:${base64url.encode("not json")}`,
    ];
    for (const issuer of [
      ...unreadable,
      ...garbled,
      `did:jwk:${base64url.encode(JSON.stringify({ kty: "oct", k: "AA" }))}`,
    ]) {
      expect(await resolver.issuerKeys(issuer), issuer).toStrictEqual([]);
    }
  });
});

describe("what a document may hold", () => {
  const clock = clockAt(0);

  it.each([
    ["a private member", { ...KEYS.es256.publicJwk, d: "AAAA" }],
    ["a use for encryption", { ...KEYS.es256.publicJwk, use: "enc" }],
    ["key operations without verify", { ...KEYS.es256.publicJwk, key_ops: ["sign"] }],
    ["a curve of no algorithm of the verification", { kty: "EC", crv: "secp256k1", x: "AA", y: "AA" }],
    ["an RSA modulus of more than 8,192 bits", { kty: "RSA", n: "A".repeat(1400), e: "AQAB" }],
    ["a symmetric key", { kty: "oct", k: "AAAA" }],
  ])("refuses a key with %s", (_name, jwk) => {
    expect(publicJwk(jwk)).toBeUndefined();
  });

  it("keeps the public members of a key and the algorithm it is for, and drops the rest", () => {
    const jwk = { ...KEYS.rs256.publicJwk, kid: "k", use: "sig", alg: "RS256", x5c: ["AAAA"] };
    expect(publicJwk(jwk)).toStrictEqual({
      kty: "RSA",
      n: KEYS.rs256.publicJwk.n,
      e: KEYS.rs256.publicJwk.e,
      alg: "RS256",
    });
  });

  it("reads a document that lists more keys than the limit as publishing none", async () => {
    const keys = Array.from({ length: 101 }, () => KEYS.es256.publicJwk);
    const { fetch } = serve({ [SET_URL]: { keys } });
    expect(await createKeyResolver({ clock, fetch }).issuerKeys(ISSUER)).toStrictEqual([]);
  });

  it("reads a controller document that lists more methods than the limit as publishing none", async () => {
    const methods = Array.from({ length: 101 }, (_, index) => ({
      id: `${ISSUER}#k${index}`,
      controller: ISSUER,
      publicKeyJwk: KEYS.es256.publicJwk,
    }));
    const { fetch } = serve({
      [ISSUER]: { id: ISSUER, verificationMethod: methods, assertionMethod: methods.map(({ id }) => id) },
    });
    expect(await createKeyResolver({ clock, fetch }).issuerKeys(ISSUER)).toStrictEqual([]);
  });

  it("reads a document that nests deeper than the limit as holding nothing, although it holds keys", async () => {
    const nest = (levels: number) => `${"[".repeat(levels)}${"]".repeat(levels)}`;
    const keys = JSON.stringify([{ ...KEYS.es256.publicJwk, kid: "a" }]);
    const { fetch } = serve({
      [SET_URL]: `{"keys":${keys},"note":${nest(15)}}`,
      "https://deep.example/.well-known/jwks.json": `{"keys":${keys},"note":${nest(16)}}`,
    });
    const resolver = createKeyResolver({ clock, fetch });
    expect(await resolver.issuerKeys(ISSUER)).toHaveLength(1);
    expect(await resolver.issuerKeys("https://deep.example/issuer")).toHaveLength(0);
  });

  it("reads text that is not a JSON object as holding nothing", async () => {
    const { fetch } = serve({ [ISSUER]: "<html></html>", [SET_URL]: "[1,2]" });
    expect(await createKeyResolver({ clock, fetch }).issuerKeys(ISSUER)).toStrictEqual([]);
  });
});

describe("a resolver of the host that never answers", () => {
  it("ends the wait of verifyIssuerKey for what the issuer publishes when the signal aborts", async () => {
    const { hang, seen } = hangingPort();
    const key = { id: `${ISSUER}#key-1`, publicKeyJwk: KEYS.es256.publicJwk, relationships: [] };
    const keys = { resolve: hang, issuerKeys: hang };
    await abortsWhileWaiting((signal) => verifyIssuerKey(key, ISSUER, { keys, signal }), seen);
  });
});

describe("a fetch that goes wrong", () => {
  const clock = clockAt(0);

  it("is a ServiceError that the caller sees, and is not kept", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return new Response("boom", { status: calls === 1 ? 503 : 200 });
    };
    const resolver = createKeyResolver({ clock, fetch });
    await expect(resolver.issuerKeys(ISSUER)).rejects.toBeInstanceOf(ServiceError);
    await expect(resolver.issuerKeys(ISSUER)).resolves.toStrictEqual([]);
  });

  it("refuses a redirect", async () => {
    const fetch = async () => new Response("", { status: 302, headers: { location: "https://other.example/" } });
    await expect(createKeyResolver({ clock, fetch }).resolve("https://example.edu/keys/1")).rejects.toBeInstanceOf(
      ServiceError,
    );
  });

  it("refuses a document of more bytes than the limit before reading the rest", async () => {
    const { fetch } = serve({ [ISSUER]: " ".repeat(2000) + JSON.stringify({ id: ISSUER }) });
    const resolver = createKeyResolver({ clock, fetch, maxBytes: 1000 });
    await expect(resolver.issuerKeys(ISSUER)).rejects.toBeInstanceOf(ServiceError);
  });

  it("does not fetch an address that is not HTTPS or that holds credentials", async () => {
    const { fetch, requests } = serve({});
    const resolver = createKeyResolver({ clock, fetch });
    for (const url of [
      "http://example.edu/keys/1",
      "https://user:pass@example.edu/keys/1",
      "ftp://example.edu/k",
      "https://[broken",
    ]) {
      expect(await resolver.resolve(url), url).toBeUndefined();
    }
    expect(requests).toStrictEqual([]);
  });

  it("ends the wait of a caller that aborts, and lets the load finish for the others", async () => {
    let release: (response: Response) => void = () => undefined;
    let calls = 0;
    const fetch = () => {
      calls += 1;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    };
    const resolver = createKeyResolver({ clock, fetch });
    const controller = new AbortController();
    const aborted = resolver.resolve("https://example.edu/keys/1", { signal: controller.signal });
    const patient = resolver.resolve("https://example.edu/keys/1");
    await Promise.resolve();
    controller.abort(new Error("stop"));
    await expect(aborted).rejects.toThrow("stop");
    release(new Response(JSON.stringify(KEYS.es256.publicJwk)));
    expect((await patient)?.id).toBe("https://example.edu/keys/1");
    expect(calls).toBe(1);
  });
});

describe("the cache of documents", () => {
  it("keeps a document for the time to live and fetches it again after", async () => {
    const clock = clockAt(1_000_000);
    const { fetch, requests } = serve({ [SET_URL]: { keys: [member(KEYS.es256, { kid: "a" })] } });
    const resolver = createKeyResolver({ clock, fetch, ttlSeconds: 100 });
    await resolver.resolve(`${SET_URL}#a`);
    clock.advance(99_000);
    await resolver.resolve(`${SET_URL}#a`);
    expect(requests).toHaveLength(1);
    clock.advance(1_000);
    await resolver.resolve(`${SET_URL}#a`);
    expect(requests).toHaveLength(2);
  });

  it("shares one fetch between callers that ask while it runs", async () => {
    const { fetch, requests } = serve({ [SET_URL]: { keys: [member(KEYS.es256, { kid: "a" })] } });
    const resolver = createKeyResolver({ clock: clockAt(0), fetch });
    await Promise.all([
      resolver.resolve(`${SET_URL}#a`),
      resolver.resolve(`${SET_URL}#a`),
      resolver.issuerKeys(ISSUER),
    ]);
    expect(requests.filter((url) => url === SET_URL)).toHaveLength(1);
  });

  it("fetches a document again for a key that it lacks at most once a minute", async () => {
    const clock = clockAt(0);
    let rotated = false;
    const requests: string[] = [];
    const fetch = async (url: string) => {
      requests.push(url);
      const keys = rotated
        ? [member(KEYS.es256, { kid: "a" }), member(KEYS.ed25519, { kid: "b" })]
        : [member(KEYS.es256, { kid: "a" })];
      return new Response(JSON.stringify({ keys }));
    };
    const resolver = createKeyResolver({ clock, fetch });
    await resolver.resolve(`${SET_URL}#a`);
    rotated = true;
    clock.advance(30_000);
    expect(await resolver.resolve(`${SET_URL}#b`)).toBeUndefined();
    expect(requests).toHaveLength(1);
    clock.advance(30_000);
    expect((await resolver.resolve(`${SET_URL}#b`))?.id).toBe(`${SET_URL}#b`);
    expect(requests).toHaveLength(2);
    for (let call = 0; call < 5; call += 1) await resolver.resolve(`${SET_URL}#nope`);
    expect(requests).toHaveLength(2);
  });

  it("keeps the most documents that it is given and drops the oldest", async () => {
    const { fetch, requests } = serve({});
    const resolver = createKeyResolver({ clock: clockAt(0), fetch });
    // Each issuer is on a host of its own, so each holds two documents: the profile and the key set.
    for (let index = 0; index < 600; index += 1) await resolver.issuerKeys(`https://host${index}.example/issuer`);
    requests.length = 0;
    await resolver.issuerKeys("https://host599.example/issuer");
    expect(requests).toHaveLength(0);
    await resolver.issuerKeys("https://host0.example/issuer");
    expect(requests).toHaveLength(2);
  });
});

describe("the tokens of a document", () => {
  const clock = clockAt(0);
  const keys = JSON.stringify([{ ...KEYS.es256.publicJwk, kid: "a" }]);

  it("are counted before the document is parsed: a document over maxTokens holds nothing", async () => {
    const { fetch } = serve({ [SET_URL]: `{"keys":${keys},"note":${HOSTILE}}` });
    const published = await neverParsesLarge(() =>
      createKeyResolver({ clock, fetch, maxBytes: 2_000_000 }).issuerKeys(ISSUER),
    );
    expect(published).toStrictEqual([]);
  });

  it("are limited by the option maxTokens, and a document within the limit is read", async () => {
    const { fetch } = serve({ [SET_URL]: `{"keys":${keys}}` });
    expect(await createKeyResolver({ clock, fetch, maxTokens: 10 }).issuerKeys(ISSUER)).toStrictEqual([]);
    expect(await createKeyResolver({ clock, fetch, maxTokens: 1000 }).issuerKeys(ISSUER)).toHaveLength(1);
  });
});

describe("the arguments", () => {
  const clock = clockAt(0);

  it("are refused for options that are null or have a clock that is none", () => {
    expect(() => createKeyResolver(JSON.parse("null"))).toThrow(DataError);
    expect(() => createKeyResolver(JSON.parse('{"clock":5}'))).toThrow(DataError);
  });

  it("take the clock of the system when the options name none", () => {
    expect(createKeyResolver(JSON.parse("{}")).resolve).toBeTypeOf("function");
  });

  it.each([
    ["a fetch that is not a function", { fetch: "x" }],
    ["a resolve that is not a function", { resolve: 5 }],
    ["methods that are not an array", { methods: "key" }],
    ["a method that is not key or web", { methods: ["ion"] }],
    ["a time to live of 0", { ttlSeconds: 0 }],
    ["a timeout that is a string", { timeoutMs: "10" }],
    ["a size limit of 1.5", { maxBytes: 1.5 }],
    ["a limit of tokens of 0", { maxTokens: 0 }],
  ])("are refused for %s", (_name, extra) => {
    expect(() => createKeyResolver({ clock, ...JSON.parse(JSON.stringify(extra)) })).toThrow(DataError);
  });

  it("are refused for a verification method that is not a string and a signal that is not one", async () => {
    const resolver = createKeyResolver({ clock });
    await expect(resolver.resolve(JSON.parse("null"))).rejects.toBeInstanceOf(DataError);
    await expect(resolver.resolve(JSON.parse("5"))).rejects.toBeInstanceOf(DataError);
    await expect(resolver.issuerKeys(JSON.parse('{"a":1}'))).rejects.toBeInstanceOf(DataError);
    await expect(resolver.issuerKeys(ISSUER, JSON.parse('{"signal":"x"}'))).rejects.toBeInstanceOf(DataError);
  });
});
