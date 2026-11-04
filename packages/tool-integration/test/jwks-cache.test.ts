// biome-ignore-all lint/style/useNamingConvention: the members of a JWK are those of RFC 7517, such as key_ops.

import { DataError, type Fetch, LimitError, ServiceError } from "@interopkit/core";
import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { createJwksCache } from "../src/index.js";

const JWKS_URL = "https://lms.example.edu/jwks";
const NO_KEY = { code: "ERR_JWKS_NO_MATCHING_KEY" };
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const encoder = new TextEncoder();

/** An RSA key pair for RS256, with its public key as the JWK that a key set publishes. */
async function keyPair(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, publicJwk: { ...jwk, kid, use: "sig", alg: "RS256" } };
}

const platformKey = await keyPair("platform-1");
const rotatedKey = await keyPair("platform-2");
const attackerKey = await keyPair("platform-1");

/** Signs claims as a compact JWS with RS256, written by hand so that the test does not verify jose with jose. */
async function signToken(claims: object, key: Awaited<ReturnType<typeof keyPair>>): Promise<string> {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${part({ alg: "RS256", kid: key.kid })}.${part(claims)}`;
  const signature = await crypto.subtle.sign(RSA, key.privateKey, encoder.encode(input));
  return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

/** A promise and the means to settle it from outside. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

/** A clock that the test moves, a party that publishes its key set, and the requests that reached it. */
function setup() {
  let time = 1_700_000_000_000;
  const clock = {
    now: () => time,
    advance: (seconds: number) => {
      time += seconds * 1000;
    },
  };
  const party = {
    published: [platformKey],
    requests: [] as string[],
    keySetResponse: undefined as (() => Response | Promise<Response>) | undefined,
  };
  const fetch: Fetch = async (url, init) => {
    party.requests.push(`${init.method} ${url}`);
    expect(init.redirect).toBe("manual");
    return party.keySetResponse?.() ?? Response.json({ keys: party.published.map((key) => key.publicJwk) });
  };
  return { clock, party, fetch };
}

/** Resolves the key of a header from the key set at `JWKS_URL`. */
const key = (cache: ReturnType<typeof createJwksCache>, kid: string | undefined, url = JWKS_URL) =>
  cache.keySet(url)({ alg: "RS256", kid }, { payload: "", signature: "" });

describe("createJwksCache", () => {
  it("fetches a key set once and serves its keys from the cache", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock });
    const first = await key(cache, "platform-1");
    expect(first).toBeDefined();
    expect(await key(cache, "platform-1")).toBe(first);
    expect(party.requests).toStrictEqual([`GET ${JWKS_URL}`]);
  });

  it("follows a rotation: a kid that the cached set lacks fetches the set again after the refresh time", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock });
    await key(cache, "platform-1");
    party.published = [rotatedKey, platformKey];
    await expect(key(cache, "platform-2")).rejects.toMatchObject(NO_KEY);
    expect(party.requests).toHaveLength(1);
    clock.advance(60);
    expect(await key(cache, "platform-2")).toBeDefined();
    expect(await key(cache, "platform-1")).toBeDefined();
    expect(party.requests).toHaveLength(2);
  });

  it("does not fetch on every request that names an invented kid", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock });
    for (let i = 0; i < 50; i += 1) await expect(key(cache, `invented-${i}`)).rejects.toMatchObject(NO_KEY);
    expect(party.requests).toHaveLength(1);
    clock.advance(59);
    await expect(key(cache, "invented-x")).rejects.toMatchObject(NO_KEY);
    expect(party.requests).toHaveLength(1);
    clock.advance(1);
    await expect(key(cache, "invented-y")).rejects.toMatchObject(NO_KEY);
    expect(party.requests).toHaveLength(2);
  });

  it("fetches a set again when it is older than the time to live", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock, ttlSeconds: 100, refreshSeconds: 10 });
    await key(cache, "platform-1");
    clock.advance(99);
    await key(cache, "platform-1");
    expect(party.requests).toHaveLength(1);
    clock.advance(1);
    await key(cache, "platform-1");
    expect(party.requests).toHaveLength(2);
  });

  it("shares one fetch among the requests that wait for it", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock });
    const keys = await Promise.all(Array.from({ length: 5 }, () => key(cache, "platform-1")));
    expect(new Set(keys).size).toBe(1);
    expect(party.requests).toHaveLength(1);
  });

  it("keeps one set for each URL, whichever function of keySet asks for it", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock });
    await key(cache, "platform-1");
    await key(cache, "platform-1");
    await key(cache, "platform-1", `${JWKS_URL}?other`);
    expect(party.requests).toStrictEqual([`GET ${JWKS_URL}`, `GET ${JWKS_URL}?other`]);
  });

  it("keeps the RSA keys that are meant for signing with RS256, and refuses a kid that two keys share", async () => {
    const { clock, party, fetch } = setup();
    party.keySetResponse = () =>
      Response.json({
        keys: [
          { ...platformKey.publicJwk, kid: "encryption", use: "enc" },
          { ...platformKey.publicJwk, kid: "other-alg", alg: "RS512" },
          { ...platformKey.publicJwk, kid: "encrypt-only", key_ops: ["encrypt"] },
          { kty: "EC", crv: "P-256", x: "a", y: "b", kid: "elliptic" },
          { ...platformKey.publicJwk, kid: undefined },
          platformKey.publicJwk,
          { ...rotatedKey.publicJwk, kid: "shared" },
          { ...attackerKey.publicJwk, kid: "shared" },
        ],
      });
    const cache = createJwksCache({ fetch, clock });
    for (const kid of ["encryption", "other-alg", "encrypt-only", "elliptic", "absent"]) {
      await expect(key(cache, kid), kid).rejects.toMatchObject(NO_KEY);
    }
    await expect(key(cache, "shared")).rejects.toMatchObject({ code: "ERR_JWKS_MULTIPLE_MATCHING_KEYS" });
    const token = await signToken({ a: 1 }, platformKey);
    const kept = await key(cache, "platform-1");
    expect(await jwtVerify(token, kept, { algorithms: ["RS256"] })).toMatchObject({ payload: { a: 1 } });
  });

  it("throws DataError for an answer that is not JSON or not a JWK Set, and keeps nothing of it", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock });
    const refused = new DataError(`The key set at ${JWKS_URL} must be a JWK Set (RFC 7517 section 5).`);
    for (const body of ["<html>", '{"keys":{}}', "[]"]) {
      party.keySetResponse = () => new Response(body);
      await expect(key(cache, "platform-1"), body).rejects.toStrictEqual(refused);
    }
    party.keySetResponse = undefined;
    expect(await key(cache, "platform-1")).toBeDefined();
    expect(party.requests).toHaveLength(4);
  });

  it("throws DataError with its cause for a key set nested too deep for jose to copy, and keeps nothing of it", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock });
    party.keySetResponse = () => new Response(`{"keys":[{"x":${"[".repeat(32_000)}${"]".repeat(32_000)}}]}`);
    const refused = await Promise.resolve(key(cache, "platform-1")).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(DataError);
    expect(refused).toHaveProperty("message", `The key set at ${JWKS_URL} must be a JWK Set (RFC 7517 section 5).`);
    expect(refused).toHaveProperty("cause");
    party.keySetResponse = undefined;
    expect(await key(cache, "platform-1")).toBeDefined();
    expect(party.requests).toHaveLength(2);
  });

  it("throws LimitError for a set of more than 100 keys, before it reads one, and keeps nothing of it", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock });
    const set = (count: number) => ({
      keys: Array.from({ length: count }, (_, index) => ({ ...platformKey.publicJwk, kid: `${index}` })),
    });
    party.keySetResponse = () => Response.json(set(101));
    await expect(key(cache, "0")).rejects.toStrictEqual(
      new LimitError(`The key set at ${JWKS_URL} has 101 keys, above the limit of 100.`, "maxKeys", 100),
    );
    party.keySetResponse = () => Response.json(set(100));
    expect(await key(cache, "99")).toBeDefined();
    expect(party.requests).toHaveLength(2);
  });

  it("throws ServiceError with the status and the body when the party refuses, and fetches again on the next call", async () => {
    const { clock, party, fetch } = setup();
    party.keySetResponse = () => new Response("down", { status: 503 });
    const cache = createJwksCache({ fetch, clock });
    await expect(key(cache, "platform-1")).rejects.toMatchObject({ name: "ServiceError", status: 503, body: "down" });
    party.keySetResponse = undefined;
    expect(await key(cache, "platform-1")).toBeDefined();
  });

  it("throws ServiceError with status 0 when the fetch fails, as it does for a redirect", async () => {
    const { clock, party, fetch } = setup();
    party.keySetResponse = () => {
      throw new TypeError("redirect mode is set to error");
    };
    const cache = createJwksCache({ fetch, clock });
    await expect(key(cache, "platform-1")).rejects.toMatchObject({ name: "ServiceError", status: 0 });
  });

  it("throws ServiceError for an answer larger than 64 KiB", async () => {
    const { clock, party, fetch } = setup();
    party.keySetResponse = () => new Response("x".repeat(65_537));
    const cache = createJwksCache({ fetch, clock });
    await expect(key(cache, "platform-1")).rejects.toMatchObject({ name: "ServiceError", status: 200 });
  });

  it("serves a key that is still fresh while the party is down, and asks it for nothing", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock, ttlSeconds: 100, refreshSeconds: 10 });
    const first = await key(cache, "platform-1");
    party.keySetResponse = () => new Response("down", { status: 503 });
    expect(await key(cache, "platform-1")).toBe(first);
    expect(party.requests).toHaveLength(1);
  });

  it("fails closed past the time to live: it rejects with ServiceError and never serves the stale key", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock, ttlSeconds: 100, refreshSeconds: 10 });
    await key(cache, "platform-1");
    party.keySetResponse = () => new Response("down", { status: 503 });
    clock.advance(100);
    await expect(key(cache, "platform-1")).rejects.toBeInstanceOf(ServiceError);
    await expect(key(cache, "platform-1")).rejects.toMatchObject({ status: 503 });
  });

  it("keeps the set it has when a fetch for a missing kid fails, and refuses that kid with the error of the fetch", async () => {
    const { clock, party, fetch } = setup();
    const cache = createJwksCache({ fetch, clock });
    const first = await key(cache, "platform-1");
    party.keySetResponse = () => new Response("down", { status: 503 });
    clock.advance(60);
    await expect(key(cache, "platform-2")).rejects.toMatchObject({ name: "ServiceError", status: 503 });
    expect(await key(cache, "platform-1")).toBe(first);
  });

  it("ends the wait of the caller whose signal aborts, and no other, on one shared fetch", async () => {
    const { clock, party, fetch } = setup();
    const gate = deferred<void>();
    party.keySetResponse = async () => {
      await gate.promise;
      return Response.json({ keys: [platformKey.publicJwk] });
    };
    const cache = createJwksCache({ fetch, clock });
    const header = { alg: "RS256", kid: "platform-1" } as const;
    const jws = { payload: "", signature: "" };
    const reason = new Error("The caller left.");
    const leaving = new AbortController();
    const ended = cache.keySet(JWKS_URL, { signal: leaving.signal })(header, jws);
    const staying = cache.keySet(JWKS_URL, { signal: new AbortController().signal })(header, jws);
    const unbound = cache.keySet(JWKS_URL)(header, jws);
    leaving.abort(reason);
    await expect(ended).rejects.toBe(reason);
    gate.resolve();
    expect(await staying).toBeDefined();
    expect(await unbound).toBeDefined();
    expect(party.requests).toHaveLength(1);
  });

  it("throws DataError for arguments and options of other types", () => {
    const { clock, fetch } = setup();
    const cache = createJwksCache({ fetch, clock });
    expect(() => cache.keySet("http://lms.example.edu/jwks")).toThrow(
      new DataError('The URL of a key set must be an absolute https URL, found "http://lms.example.edu/jwks".'),
    );
    const options = { fetch, clock };
    const bad: readonly [string, () => unknown][] = [
      ["The options must be an object, found null.", () => createJwksCache(JSON.parse("null"))],
      [
        'The option fetch must be a function, found "f".',
        () => createJwksCache({ ...options, fetch: JSON.parse('"f"') }),
      ],
      ["The option clock must be an object, found null.", () => createJwksCache({ fetch, clock: JSON.parse("null") })],
      [
        "The option ttlSeconds must be a positive integer, found 0.",
        () => createJwksCache({ ...options, ttlSeconds: 0 }),
      ],
      [
        'The option refreshSeconds must be a positive integer, found "1".',
        () => createJwksCache({ ...options, refreshSeconds: JSON.parse('"1"') }),
      ],
      [
        "The option timeoutMs must be a positive integer, found null.",
        () => createJwksCache({ ...options, timeoutMs: JSON.parse("null") }),
      ],
    ];
    for (const [message, call] of bad) expect(call, message).toThrow(new DataError(message));
  });
});
