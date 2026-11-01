import fc from "fast-check";
import { base64url } from "jose";
import { describe, expect, it } from "vitest";
import type { IssuableCredential } from "../src/index.js";
import { readCredentialJwt, signCredentialJwt } from "../src/jwt/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { publicJwk } from "../src/keys/internal.js";
import { achievementCredential } from "./fixtures.js";
import { clockAt, KEYS, serve, signerOf } from "./key-fixtures.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_104, numRuns: 200 };

const ISSUER = "https://example.edu/issuers/1";
const SET_URL = "https://example.edu/.well-known/jwks.json";
const encoder = new TextEncoder();

/** A JSON value of any shape, as a server could answer it. */
const anyJson = fc.jsonValue({ maxDepth: 6 });

describe("the documents that a server answers", () => {
  it("never make the resolver throw, whatever the JSON, and leave only public keys", async () => {
    await fc.assert(
      fc.asyncProperty(anyJson, anyJson, async (profile, set) => {
        const { fetch } = serve({ [ISSUER]: JSON.stringify(profile), [SET_URL]: JSON.stringify(set) });
        const keys = await createKeyResolver({ clock: clockAt(0), fetch }).issuerKeys(ISSUER);
        for (const key of keys) {
          expect(publicJwk(key.publicKeyJwk)).toStrictEqual(key.publicKeyJwk);
          expect(key.publicKeyJwk).not.toHaveProperty("d");
        }
      }),
      RUNS,
    );
  });

  it("never make the resolver throw when they are text and not JSON", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (text) => {
        const { fetch } = serve({ [ISSUER]: text, "https://example.edu/keys/1": text });
        const resolver = createKeyResolver({ clock: clockAt(0), fetch });
        await resolver.issuerKeys(ISSUER);
        await resolver.resolve("https://example.edu/keys/1#x");
      }),
      RUNS,
    );
  });

  it("never make a key of a set that holds a private member", async () => {
    const member = fc.record(
      { kty: fc.constantFrom("RSA", "EC", "OKP", "oct"), d: fc.string(), k: fc.string() },
      { requiredKeys: ["kty"] },
    );
    await fc.assert(
      fc.asyncProperty(fc.array(member, { maxLength: 5 }), async (keys) => {
        const merged = keys.map((key) => ({ ...KEYS.es256.publicJwk, ...key }));
        const { fetch } = serve({ [SET_URL]: { keys: merged } });
        const published = await createKeyResolver({ clock: clockAt(0), fetch }).issuerKeys(ISSUER);
        const withPrivate = merged.filter((key) => "d" in key || "k" in key).length;
        expect(published.length).toBeLessThanOrEqual(merged.length - withPrivate);
      }),
      RUNS,
    );
  });
});

describe("a compact JWS", () => {
  const clock = clockAt(Date.UTC(2024, 5, 14));
  const options = () => ({ keys: createKeyResolver({ clock, fetch: serve({}).fetch }), clock });

  it("is refused as a value, whatever the text", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 300 }), async (text) => {
        expect(await readCredentialJwt(text, options())).toMatchObject({ valid: false });
      }),
      RUNS,
    );
  });

  it("is refused as a value when its three parts are base64url of any bytes", async () => {
    const part = fc.uint8Array({ maxLength: 120 }).map((bytes) => base64url.encode(bytes));
    await fc.assert(
      fc.asyncProperty(part, part, part, async (header, payload, signature) => {
        expect((await readCredentialJwt(`${header}.${payload}.${signature}`, options())).valid).toBe(false);
      }),
      RUNS,
    );
  });

  it("is refused as a value when its header is any JSON and its payload is any JSON", async () => {
    const part = anyJson.map((value) => base64url.encode(encoder.encode(JSON.stringify(value))));
    await fc.assert(
      fc.asyncProperty(part, part, async (header, payload) => {
        expect((await readCredentialJwt(`${header}.${payload}.AAAA`, options())).valid).toBe(false);
      }),
      RUNS,
    );
  });

  it("is never valid after a character of it was changed", async () => {
    const issuer = clockAt(Date.UTC(2024, 5, 14));
    const { fetch } = serve({});
    const read = { keys: createKeyResolver({ clock: issuer, fetch }), clock: issuer, allowUnboundKeys: true };
    const jws = await signCredentialJwt(
      achievementCredential() as unknown as IssuableCredential,
      signerOf(KEYS.es256),
      {
        jwk: KEYS.es256.publicJwk,
      },
    );
    expect((await readCredentialJwt(jws, read)).valid).toBe(true);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.";
    await fc.assert(
      fc.asyncProperty(fc.nat(jws.length - 1), fc.constantFrom(...alphabet), async (index, char) => {
        fc.pre(jws[index] !== char);
        const changed = `${jws.slice(0, index)}${char}${jws.slice(index + 1)}`;
        expect((await readCredentialJwt(changed, read)).valid).toBe(false);
      }),
      RUNS,
    );
  });
});
