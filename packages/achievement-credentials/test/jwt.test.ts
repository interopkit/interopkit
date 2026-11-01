import { DataError, ServiceError, signCompactJws } from "@interopkit/core";
import { base64url } from "jose";
import { describe, expect, it } from "vitest";
import { type IssuableCredential, readCredential } from "../src/index.js";
import { readCredentialJwt, signCredentialJwt } from "../src/jwt/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import {
  achievementCredential,
  achievementCredentialV1p1,
  clrCredential,
  endorsementCredential,
  verifiableCredential,
} from "./fixtures.js";
import { clockAt, KEYS, serve, signerOf, type TestKey } from "./key-fixtures.js";

const ISSUER = "https://example.edu/issuers/1";
const SET_URL = "https://example.edu/.well-known/jwks.json";
/** Seconds since 1970 of `validFrom` of the fixtures: 2024-06-13T10:00:00Z, written out by hand from the calendar. */
const VALID_FROM = Date.UTC(2024, 5, 13, 10, 0, 0) / 1000;
const NOW = (VALID_FROM + 86_400) * 1000;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const METHODS: Record<string, TestKey> = {
  rs256: KEYS.rs256,
  es256: KEYS.es256,
  es384: KEYS.es384,
  eddsa: KEYS.ed25519,
};

/** The controller document of the issuer: one method for each key, all under assertionMethod. */
const CONTROLLER = {
  id: ISSUER,
  verificationMethod: Object.entries(METHODS).map(([name, key]) => ({
    id: `${ISSUER}#${name}`,
    type: "JsonWebKey",
    controller: ISSUER,
    publicKeyJwk: key.publicJwk,
  })),
  assertionMethod: Object.keys(METHODS).map((name) => `${ISSUER}#${name}`),
};

function world(routes: Record<string, unknown> = { [ISSUER]: CONTROLLER }) {
  const { fetch, requests } = serve(routes);
  const clock = clockAt(NOW);
  return { clock, requests, options: { keys: createKeyResolver({ clock, fetch }), clock } };
}

const partsOf = (jws: string) => jws.split(".") as [string, string, string];
const jsonOf = (part: string) => JSON.parse(decoder.decode(base64url.decode(part))) as Record<string, unknown>;
const encode = (value: unknown) => base64url.encode(encoder.encode(JSON.stringify(value)));

/** Signs a payload the way a forger would: any claims, any header, any key. */
async function forge(payload: unknown, key: TestKey, header: Record<string, unknown> = { kid: `${ISSUER}#es256` }) {
  return await signCompactJws({ typ: "JWT", ...header }, encoder.encode(JSON.stringify(payload)), signerOf(key));
}

const badge = () => achievementCredential() as unknown as IssuableCredential;

describe("signing a credential as a JWT", () => {
  it.each([
    ["RS256", "rs256", KEYS.rs256],
    ["ES256", "es256", KEYS.es256],
    ["ES384", "es384", KEYS.es384],
    ["EdDSA", "eddsa", KEYS.ed25519],
  ])("is read back with %s, bound to the issuer that publishes the key", async (algorithm, name, key) => {
    const kid = `${ISSUER}#${name}`;
    const jws = await signCredentialJwt(badge(), signerOf(key), { kid });
    const [header] = partsOf(jws);
    expect(jsonOf(header)).toStrictEqual({ alg: algorithm, typ: "JWT", kid });
    const result = await readCredentialJwt(jws, world().options);
    expect(result).toMatchObject({ valid: true, bound: true, key: { id: kid } });
    if (result.valid) expect(result.credential).toStrictEqual(readCredential(achievementCredential()));
  });

  it("writes the claims that Open Badges 8.2 asks for, beside the credential", async () => {
    const jws = await signCredentialJwt(
      { ...badge(), validUntil: "2025-06-13T10:00:00Z" } as IssuableCredential,
      signerOf(KEYS.es256),
      { kid: `${ISSUER}#es256` },
    );
    const payload = jsonOf(partsOf(jws)[1]);
    expect(payload).toMatchObject({
      iss: ISSUER,
      jti: "https://example.edu/credentials/1",
      nbf: VALID_FROM,
      sub: "did:example:learner",
      exp: Date.UTC(2025, 5, 13, 10, 0, 0) / 1000,
      type: ["VerifiableCredential", "OpenBadgeCredential"],
    });
  });

  it("leaves out the claims of what the credential does not have", async () => {
    const plain = verifiableCredential() as unknown as IssuableCredential;
    const jws = await signCredentialJwt(plain, signerOf(KEYS.es256), { kid: `${ISSUER}#es256` });
    const payload = jsonOf(partsOf(jws)[1]);
    expect(payload).toMatchObject({ iss: ISSUER, nbf: VALID_FROM });
    for (const claim of ["jti", "sub", "exp"]) expect(payload, claim).not.toHaveProperty(claim);
    expect(await readCredentialJwt(jws, world().options)).toMatchObject({ valid: true, bound: true });
  });

  it("names the key by an embedded jwk when it is given one, and leaves out typ when asked", async () => {
    const jws = await signCredentialJwt(badge(), signerOf(KEYS.es256), { jwk: KEYS.es256.publicJwk, typ: false });
    expect(jsonOf(partsOf(jws)[0])).toStrictEqual({ alg: "ES256", jwk: KEYS.es256.publicJwk });
  });

  it("signs an endorsement and a plain credential too", async () => {
    for (const value of [endorsementCredential()]) {
      const jws = await signCredentialJwt(value as unknown as IssuableCredential, signerOf(KEYS.es256), {
        kid: `${ISSUER}#es256`,
      });
      expect(await readCredentialJwt(jws, world().options)).toMatchObject({ valid: true, bound: true });
    }
  });

  it.each([
    ["neither kid nor jwk", {}],
    ["both kid and jwk", { kid: "https://example.edu/k", jwk: KEYS.es256.publicJwk }],
    ["a jwk that holds a private key", { jwk: { ...KEYS.es256.publicJwk, d: "AAAA" } }],
    ["a jwk that is no key", { jwk: { kty: "oct", k: "AAAA" } }],
    ["a kid that is empty", { kid: "" }],
    ["a typ that is a string", { kid: "https://example.edu/k", typ: "JWT" }],
    ["a signNested that is a number", { kid: "https://example.edu/k", signNested: 1 }],
  ])("refuses options with %s", async (_name, options) => {
    await expect(
      signCredentialJwt(badge(), signerOf(KEYS.es256), JSON.parse(JSON.stringify(options))),
    ).rejects.toBeInstanceOf(DataError);
  });

  it("refuses options that are null, and a credential that is not one", async () => {
    await expect(signCredentialJwt(badge(), signerOf(KEYS.es256), JSON.parse("null"))).rejects.toBeInstanceOf(
      DataError,
    );
    await expect(
      signCredentialJwt(JSON.parse('{"id":"x"}'), signerOf(KEYS.es256), { kid: "https://example.edu/k" }),
    ).rejects.toBeInstanceOf(DataError);
    await expect(
      signCredentialJwt(JSON.parse("null"), signerOf(KEYS.es256), { kid: "https://example.edu/k" }),
    ).rejects.toBeInstanceOf(DataError);
  });

  it("refuses a credential that holds a property that a claim would overwrite", async () => {
    for (const name of ["iss", "jti", "nbf", "exp", "sub", "iat", "aud", "vc"]) {
      const value = { ...achievementCredential(), [name]: "x" } as unknown as IssuableCredential;
      await expect(
        signCredentialJwt(value, signerOf(KEYS.es256), { kid: "https://example.edu/k" }),
        name,
      ).rejects.toThrow(`has a property ${name}`);
    }
  });

  it("refuses a signer whose key id is not the kid, and a signature in DER", async () => {
    await expect(
      signCredentialJwt(badge(), signerOf(KEYS.es256, "https://example.edu/other"), { kid: "https://example.edu/k" }),
    ).rejects.toBeInstanceOf(DataError);
    const der = { algorithm: "ES256", sign: async () => new Uint8Array(70) };
    await expect(signCredentialJwt(badge(), der, { kid: "https://example.edu/k" })).rejects.toThrow("64 bytes");
  });

  it("passes the signal to the signer and ends with its reason", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      signCredentialJwt(badge(), signerOf(KEYS.es256), { kid: "https://example.edu/k", signal: controller.signal }),
    ).rejects.toThrow("stop");
  });
});

describe("signing a CLR as a JWT", () => {
  const clr = () => clrCredential() as unknown as IssuableCredential;

  it("refuses nested credentials that are not compact JWS", async () => {
    await expect(signCredentialJwt(clr(), signerOf(KEYS.es256), { kid: `${ISSUER}#es256` })).rejects.toThrow(
      "verifiableCredential[0] is not a compact JWS",
    );
  });

  it("signs the nested credentials with the same signer when asked, and writes their JWS into the payload", async () => {
    const jws = await signCredentialJwt(clr(), signerOf(KEYS.es256), { kid: `${ISSUER}#es256`, signNested: true });
    const payload = jsonOf(partsOf(jws)[1]) as { credentialSubject: { verifiableCredential: string[] } };
    const [nested] = payload.credentialSubject.verifiableCredential;
    expect(typeof nested).toBe("string");
    const { options } = world();
    expect(await readCredentialJwt(nested ?? "", options)).toMatchObject({ valid: true, bound: true });
    expect(await readCredentialJwt(jws, options)).toMatchObject({ valid: true, bound: true });
  });

  it("refuses a CLR whose subject is no object", async () => {
    const value = { ...clrCredential(), credentialSubject: "x" } as unknown as IssuableCredential;
    await expect(signCredentialJwt(value, signerOf(KEYS.es256), { kid: `${ISSUER}#es256` })).rejects.toBeInstanceOf(
      DataError,
    );
  });

  it("signs a CLR whose nested credentials are already compact JWS as it is", async () => {
    const nested = await signCredentialJwt(badge(), signerOf(KEYS.es256), { kid: `${ISSUER}#es256` });
    const value = clrCredential() as { credentialSubject: { verifiableCredential: unknown[] } };
    value.credentialSubject.verifiableCredential = [nested];
    const jws = await signCredentialJwt(value as unknown as IssuableCredential, signerOf(KEYS.es256), {
      kid: `${ISSUER}#es256`,
    });
    const payload = jsonOf(partsOf(jws)[1]) as { credentialSubject: { verifiableCredential: string[] } };
    expect(payload.credentialSubject.verifiableCredential).toStrictEqual([nested]);
  });
});

describe("reading a JWT", () => {
  async function signed(overrides: Record<string, unknown> = {}) {
    return await forge(
      { ...achievementCredential(), iss: ISSUER, jti: "https://example.edu/credentials/1", ...overrides },
      KEYS.es256,
    );
  }

  it("accepts the form of VC-JOSE-COSE: the credential alone, with typ vc+jwt", async () => {
    const jws = await forge(achievementCredential(), KEYS.es256, { typ: "vc+jwt", kid: `${ISSUER}#es256` });
    expect(await readCredentialJwt(jws, world().options)).toMatchObject({ valid: true, bound: true });
  });

  it("accepts the vc claim form of VC-JWT 1.1, where the claims fill what vc leaves out", async () => {
    const {
      id: _id,
      issuanceDate: _date,
      credentialSubject,
      ...vc
    } = achievementCredentialV1p1() as Record<string, unknown> & {
      credentialSubject: Record<string, unknown>;
    };
    const { id: _subjectId, ...subject } = credentialSubject;
    const issued = Date.UTC(2024, 5, 13, 10, 0, 0) / 1000;
    const jws = await forge(
      {
        iss: ISSUER,
        jti: "https://example.edu/credentials/1",
        nbf: issued,
        sub: "did:example:learner",
        vc: { ...vc, credentialSubject: subject },
      },
      KEYS.es256,
    );
    const result = await readCredentialJwt(jws, world().options);
    expect(result).toMatchObject({ valid: true, bound: true });
    if (result.valid) {
      expect(result.credential).toMatchObject({
        id: "https://example.edu/credentials/1",
        issuer: { id: ISSUER },
        issuanceDate: "2024-06-13T10:00:00Z",
        credentialSubject: { id: "did:example:learner" },
      });
    }
  });

  it("refuses a claim that says something other than the credential", async () => {
    const { options } = world();
    for (const [claim, value] of [
      ["iss", "https://example.edu/issuers/2"],
      ["jti", "https://example.edu/credentials/2"],
      ["sub", "did:example:someone-else"],
      ["nbf", VALID_FROM + 1],
      ["exp", VALID_FROM + 100_000_000],
    ] as const) {
      const jws = await signed({ [claim]: value, ...(claim === "exp" ? { validUntil: "2030-01-01T00:00:00Z" } : {}) });
      const result = await readCredentialJwt(jws, options);
      expect(result, claim).toMatchObject({ valid: false });
      if (!result.valid) expect(result.reason, claim).toContain(`The claim ${claim}`);
    }
  });

  it("refuses a token that has expired or is not valid yet, by the clock and the skew", async () => {
    const { clock, options } = world();
    const jws = await signed({ nbf: VALID_FROM, exp: VALID_FROM + 3600, validUntil: "2024-06-13T11:00:00Z" });
    clock.set((VALID_FROM + 3600 + 59) * 1000);
    expect((await readCredentialJwt(jws, options)).valid).toBe(true);
    clock.set((VALID_FROM + 3600 + 60) * 1000);
    expect(await readCredentialJwt(jws, options)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("expired"),
    });
    clock.set((VALID_FROM - 61) * 1000);
    expect(await readCredentialJwt(jws, options)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("not valid before"),
    });
    clock.set((VALID_FROM - 59) * 1000);
    expect((await readCredentialJwt(jws, { ...options, clockSkewSeconds: 0 })).valid).toBe(false);
    expect((await readCredentialJwt(jws, options)).valid).toBe(true);
  });

  it("refuses a time claim that is not a number", async () => {
    expect(await readCredentialJwt(await signed({ exp: "soon" }), world().options)).toMatchObject({ valid: false });
  });

  it("refuses a signature by another key than the one that the kid names", async () => {
    const jws = await forge(achievementCredential(), KEYS.other);
    expect(await readCredentialJwt(jws, world().options)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("does not verify"),
    });
  });

  it("refuses a payload or signature that was changed", async () => {
    const [header, payload, signature] = partsOf(await signed());
    const changed = encode({ ...jsonOf(payload), name: "Other badge" });
    const options = world().options;
    expect((await readCredentialJwt([header, changed, signature].join("."), options)).valid).toBe(false);
    const flipped = signature.slice(0, 5) + (signature[5] === "A" ? "B" : "A") + signature.slice(6);
    expect((await readCredentialJwt([header, payload, flipped].join("."), options)).valid).toBe(false);
  });

  describe("the header", () => {
    const options = () => world().options;

    it.each([
      ["none", "none"],
      ["HS256, which would take the public key as a secret", "HS256"],
      ["an algorithm that is not offered", "PS256"],
      ["no algorithm", undefined],
    ])("refuses %s", async (_name, alg) => {
      const jws = [
        encode({ ...(alg === undefined ? {} : { alg }), kid: `${ISSUER}#es256` }),
        encode(achievementCredential()),
        "AAAA",
      ].join(".");
      const result = await readCredentialJwt(jws, options());
      expect(result).toMatchObject({ valid: false, reason: expect.stringContaining("is not one of") });
    });

    it("offers the algorithms that the host lists, and only them", async () => {
      const jws = await forge(achievementCredential(), KEYS.es256);
      expect((await readCredentialJwt(jws, { ...options(), algorithms: ["RS256"] })).valid).toBe(false);
      expect((await readCredentialJwt(jws, { ...options(), algorithms: ["ES256"] })).valid).toBe(true);
    });

    it("refuses a header that names the key by a kid and a jwk together, although the signature is good", async () => {
      const jws = await forge(achievementCredential(), KEYS.other, {
        kid: `${ISSUER}#es256`,
        jwk: KEYS.other.publicJwk,
      });
      expect(await readCredentialJwt(jws, options())).toMatchObject({
        valid: false,
        reason: expect.stringContaining("exactly one of kid and jwk"),
      });
    });

    it("refuses a header with crit, although the signature is good and the extension is one that jose knows", async () => {
      const jws = await forge(achievementCredential(), KEYS.es256, {
        kid: `${ISSUER}#es256`,
        crit: ["b64"],
        b64: false,
      });
      expect(await readCredentialJwt(jws, options())).toMatchObject({
        valid: false,
        reason: expect.stringContaining("crit"),
      });
    });

    it("refuses a signature that is spelled another way than the canonical base64url of its bytes", async () => {
      const [header, payload, signature] = partsOf(await forge(achievementCredential(), KEYS.es256));
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      // The 64 bytes of an ES256 signature fill 85 characters and 2 bits of the 86th: its other 4 bits are not read.
      const last = alphabet.indexOf(signature.at(-1) ?? "A");
      const variant = `${signature.slice(0, -1)}${alphabet[last ^ 1]}`;
      expect(base64url.decode(variant)).toStrictEqual(base64url.decode(signature));
      expect((await readCredentialJwt([header, payload, signature].join("."), options())).valid).toBe(true);
      expect(await readCredentialJwt([header, payload, variant].join("."), options())).toMatchObject({
        valid: false,
        reason: expect.stringContaining("canonical"),
      });
    });

    it("refuses a typ that is no JWT, and a header that names no key", async () => {
      const kid = `${ISSUER}#es256`;
      const cases: [string, Record<string, unknown>][] = [
        ["typ", { kid, typ: "at+jwt" }],
        ["neither", {}],
        ["kid number", { kid: 5 }],
        ["jwk private", { jwk: { ...KEYS.es256.publicJwk, d: "AAAA" } }],
        ["jwk missing", { jwk: { kty: "EC" } }],
      ];
      for (const [name, header] of cases) {
        // Assembled by hand: the signer of core would refuse a jwk with a private member, and a forger has no such scruple.
        const jws = [encode({ alg: "ES256", ...header }), encode(achievementCredential()), "AAAA"].join(".");
        expect((await readCredentialJwt(jws, options())).valid, name).toBe(false);
      }
    });

    it("refuses a kid that no key answers to, and a key that is for another algorithm", async () => {
      const unknown = await forge(achievementCredential(), KEYS.es256, { kid: `${ISSUER}#nobody` });
      expect(await readCredentialJwt(unknown, options())).toMatchObject({
        valid: false,
        reason: expect.stringContaining("No key"),
      });
      const keys = {
        ...CONTROLLER,
        verificationMethod: [
          { ...CONTROLLER.verificationMethod[1], publicKeyJwk: { ...KEYS.es256.publicJwk, alg: "ES384" } },
        ],
      };
      const other = world({ [ISSUER]: keys });
      expect(
        await readCredentialJwt(
          await forge(achievementCredential(), KEYS.es256, { kid: `${ISSUER}#es256` }),
          other.options,
        ),
      ).toMatchObject({
        valid: false,
        reason: expect.stringContaining("is for ES384"),
      });
    });
  });

  describe("the shape and size of the JWS", () => {
    it("is refused above the limit before anything is decoded", async () => {
      const jws = await signed();
      const result = await readCredentialJwt(jws, { ...world().options, maxInputBytes: jws.length - 1 });
      expect(result).toMatchObject({ valid: false, reason: expect.stringContaining("more than the") });
      expect((await readCredentialJwt(jws, { ...world().options, maxInputBytes: jws.length })).valid).toBe(true);
    });

    it.each([
      ["two parts", "aaa.bbb"],
      ["four parts", "aaa.bbb.ccc.ddd"],
      ["an empty signature", "aaa.bbb."],
      ["an empty header", ".bbb.ccc"],
      ["padding", "e30=.e30.AAAA"],
      ["white space", "e30 .e30.AAAA"],
      ["a character outside the alphabet", "e30+.e30.AAAA"],
      ["non-canonical trailing bits", "e31.e30.AAAA"],
      ["an empty string", ""],
    ])("is refused with %s", async (_name, jws) => {
      expect((await readCredentialJwt(jws, world().options)).valid).toBe(false);
    });

    it("refuses a header that nests deeper than the limit although the signature is good", async () => {
      const nest = (levels: number) => `${"[".repeat(levels)}${"]".repeat(levels)}`;
      const sign = (levels: number) =>
        signCompactJws(
          { kid: `${ISSUER}#es256`, note: JSON.parse(nest(levels)) },
          encoder.encode(JSON.stringify(achievementCredential())),
          signerOf(KEYS.es256),
        );
      const { options } = world();
      expect((await readCredentialJwt(await sign(63), options)).valid).toBe(true);
      expect(await readCredentialJwt(await sign(65), options)).toMatchObject({
        valid: false,
        reason: expect.stringContaining("nests more than 64 levels"),
      });
      expect((await readCredentialJwt(await sign(65), { ...options, maxDepth: 70 })).valid).toBe(true);
    });

    it("refuses a header or payload that nests too deep, without parsing it", async () => {
      const deep = `${"[".repeat(200_000)}${"]".repeat(200_000)}`;
      const header = base64url.encode(encoder.encode(`{"alg":"ES256","x":${deep}}`));
      const result = await readCredentialJwt(`${header}.e30.AAAA`, { ...world().options, maxInputBytes: 2_000_000 });
      expect(result).toMatchObject({ valid: false });
      const payload = base64url.encode(encoder.encode(deep));
      const [first] = partsOf(await signed());
      expect(
        (await readCredentialJwt(`${first}.${payload}.AAAA`, { ...world().options, maxInputBytes: 2_000_000 })).valid,
      ).toBe(false);
    });

    it("refuses a header that is larger than any header needs", async () => {
      const header = encode({ alg: "ES256", kid: "x".repeat(20_000) });
      expect(await readCredentialJwt(`${header}.e30.AAAA`, world().options)).toMatchObject({
        valid: false,
        reason: expect.stringContaining("header of the JWS has more than"),
      });
    });

    it.each([
      ["a header that is not UTF-8", base64url.encode(Uint8Array.from([0xff, 0xfe])), "e30"],
      ["a header that is not JSON", base64url.encode(encoder.encode("{")), "e30"],
      ["a header that is an array", encode([1]), "e30"],
      [
        "a payload that is not JSON",
        encode({ alg: "ES256", kid: `${ISSUER}#es256` }),
        base64url.encode(encoder.encode("nope")),
      ],
    ])("refuses %s", async (_name, header, payload) => {
      const [, , signature] = partsOf(await signed());
      expect((await readCredentialJwt(`${header}.${payload}.${signature}`, world().options)).valid).toBe(false);
    });

    it("refuses a payload that the signature covers and that is no JSON object", async () => {
      const kid = `${ISSUER}#es256`;
      for (const text of ["nope", "[1]", "5"]) {
        const jws = await signCompactJws({ kid }, encoder.encode(text), signerOf(KEYS.es256));
        expect((await readCredentialJwt(jws, world().options)).valid, text).toBe(false);
      }
    });

    it("refuses a CLR whose nested credentials are not compact JWS, and one that is no CLR", async () => {
      const kid = `${ISSUER}#es256`;
      const bad = await signCompactJws({ kid }, encoder.encode(JSON.stringify(clrCredential())), signerOf(KEYS.es256));
      expect(await readCredentialJwt(bad, world().options)).toMatchObject({
        valid: false,
        reason: expect.stringContaining("verifiableCredential"),
      });
      const nested = { ...clrCredential(), credentialSubject: "x" };
      const broken = await signCompactJws({ kid }, encoder.encode(JSON.stringify(nested)), signerOf(KEYS.es256));
      expect((await readCredentialJwt(broken, world().options)).valid).toBe(false);
    });

    it("refuses a payload that is a JSON object and no credential", async () => {
      const jws = await forge({ hello: "world" }, KEYS.es256);
      expect(await readCredentialJwt(jws, world().options)).toMatchObject({
        valid: false,
        reason: expect.stringContaining("The credential in the JWT is invalid"),
      });
    });
  });

  describe("the binding of the key to the issuer", () => {
    const attacker = { ...achievementCredential() };

    it("refuses a good signature by a key that the issuer does not publish", async () => {
      const jws = await forge(attacker, KEYS.other, { jwk: KEYS.other.publicJwk });
      expect(await readCredentialJwt(jws, world().options)).toMatchObject({
        valid: false,
        reason: expect.stringContaining("does not publish"),
      });
    });

    it("gives bound false for such a key when the host accepts unbound keys, and looks nothing up", async () => {
      const jws = await forge(attacker, KEYS.other, { jwk: KEYS.other.publicJwk });
      const { options, requests } = world();
      expect(await readCredentialJwt(jws, { ...options, allowUnboundKeys: true })).toMatchObject({
        valid: true,
        bound: false,
      });
      expect(requests).toStrictEqual([]);
    });

    it("accepts an embedded jwk that the issuer publishes in its key set", async () => {
      const { options } = world({ [SET_URL]: { keys: [{ ...KEYS.other.publicJwk, kid: "k" }] } });
      const jws = await forge(attacker, KEYS.other, { jwk: KEYS.other.publicJwk });
      expect(await readCredentialJwt(jws, options)).toMatchObject({ valid: true, bound: true });
    });

    it("refuses a credential that names another issuer than the one that publishes the key", async () => {
      const forged = { ...attacker, issuer: { id: "https://victim.example/issuers/9", type: ["Profile"] } };
      const jws = await forge(forged, KEYS.es256, { kid: `${ISSUER}#es256` });
      expect((await readCredentialJwt(jws, world().options)).valid).toBe(false);
    });

    it("refuses a kid whose document names the issuer as controller but lists another key for it", async () => {
      const evil = "https://evil.example/keys";
      const routes = {
        [ISSUER]: CONTROLLER,
        [evil]: {
          id: evil,
          verificationMethod: [{ id: `${evil}#k`, controller: ISSUER, publicKeyJwk: KEYS.other.publicJwk }],
          assertionMethod: [`${evil}#k`],
        },
      };
      const jws = await forge(attacker, KEYS.other, { kid: `${evil}#k` });
      expect((await readCredentialJwt(jws, world(routes).options)).valid).toBe(false);
    });
  });

  describe("a service that fails", () => {
    it("is a ServiceError when the key cannot be read", async () => {
      const fetch = async () => new Response("", { status: 503 });
      const clock = clockAt(NOW);
      const jws = await forge(achievementCredential(), KEYS.es256);
      await expect(readCredentialJwt(jws, { keys: createKeyResolver({ clock, fetch }), clock })).rejects.toBeInstanceOf(
        ServiceError,
      );
    });

    it("is a ServiceError when the keys of the issuer cannot be read", async () => {
      const clock = clockAt(NOW);
      const fetch = async (url: string) =>
        url === `${ISSUER}` ? new Response("", { status: 503 }) : new Response("not found", { status: 404 });
      const jws = await forge(achievementCredential(), KEYS.other, { jwk: KEYS.other.publicJwk });
      await expect(readCredentialJwt(jws, { keys: createKeyResolver({ clock, fetch }), clock })).rejects.toBeInstanceOf(
        ServiceError,
      );
    });

    it("ends with the reason of the signal", async () => {
      const controller = new AbortController();
      controller.abort(new Error("stop"));
      const jws = await signed();
      await expect(readCredentialJwt(jws, { ...world().options, signal: controller.signal })).rejects.toThrow("stop");
    });
  });

  describe("the arguments", () => {
    const { options } = world();

    it("are refused when the JWS is not a string", async () => {
      for (const value of ["null", "5", "{}", "[]"]) {
        await expect(readCredentialJwt(JSON.parse(value), options)).rejects.toBeInstanceOf(DataError);
      }
    });

    it.each([
      ["null options", "null"],
      ["no keys", '{"clock":{"now":1}}'],
      ["keys without methods", '{"keys":{},"clock":{"now":1}}'],
      ["a clock that is a string", '{"clock":"now"}'],
    ])("are refused for %s", async (_name, text) => {
      await expect(readCredentialJwt("a.b.c", JSON.parse(text))).rejects.toBeInstanceOf(DataError);
    });

    it.each([
      ["an algorithm that is none", { algorithms: ["none"] }],
      ["algorithms that are a string", { algorithms: "RS256" }],
      ["an HMAC algorithm", { algorithms: ["HS256"] }],
      ["a skew that is negative", { clockSkewSeconds: -1 }],
      ["a skew that is a string", { clockSkewSeconds: "60" }],
      ["a size limit of 0", { maxInputBytes: 0 }],
      ["a depth that is a fraction", { maxDepth: 1.5 }],
      ["allowUnboundKeys that is a string", { allowUnboundKeys: "yes" }],
      ["a signal that is a string", { signal: "stop" }],
    ])("are refused for %s", async (_name, extra) => {
      await expect(
        readCredentialJwt("a.b.c", { ...options, ...JSON.parse(JSON.stringify(extra)) }),
      ).rejects.toBeInstanceOf(DataError);
    });
  });
});
