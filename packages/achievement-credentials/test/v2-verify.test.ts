import { readFileSync } from "node:fs";
import fc from "fast-check";
import { CompactSign, exportSPKI, generateKeyPair, importJWK } from "jose";
import { describe, expect, it } from "vitest";
import type { BadgeAssertionV2, VerificationResult } from "../src/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { verifyCredential } from "../src/verify/index.js";
import { clockAt } from "./key-fixtures.js";

type Json = Record<string, unknown>;

/** The badges that `validation/ob2_badges.py` writes with jwcrypto, as a host serves them, and the outcome of each. */
interface Fixture {
  readonly now: string;
  readonly recipient: { readonly type: string; readonly value: string };
  readonly documents: Readonly<Record<string, { readonly status: number; readonly body: unknown }>>;
  readonly cases: readonly { readonly name: string; readonly outcome: string; readonly input: unknown }[];
}

const FIXTURE: Fixture = JSON.parse(
  readFileSync(new URL("./fixtures/open-badges-2/badges.json", import.meta.url), "utf8"),
);
const NOW = Date.parse(FIXTURE.now);
const HOST = "https://badges.example.org";

/** The check that each outcome of the fixture fails, which the construction of its badge gives. */
const FAILS: Readonly<Record<string, string | undefined>> = {
  valid: undefined,
  revoked: "status",
  expired: "validity",
  "outside-policy": "issuer",
  "bad-signature": "proof",
  "unlisted-key": "issuer",
};

/** A host that serves documents by address, as the fixture server of the badges does, and records each request. */
function host(documents: Fixture["documents"] = FIXTURE.documents) {
  const requests: string[] = [];
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    const document = documents[url];
    if (document === undefined) return new Response("", { status: 404 });
    return new Response(document.body === null ? null : JSON.stringify(document.body), { status: document.status });
  };
  return { fetch, requests };
}

/** The options of a verification at the instant that the fixture calls now, with a host of the documents. */
function optionsOf(documents?: Fixture["documents"], more: Json = {}) {
  const clock = clockAt(NOW);
  const { fetch, requests } = host(documents);
  return { options: { keys: createKeyResolver({ clock }), clock, fetch, ...more }, requests };
}

const outcomes = (result: VerificationResult) =>
  Object.fromEntries(result.checks.map(({ check, outcome }) => [check, outcome]));
const failing = (result: VerificationResult) =>
  result.checks.find(({ outcome }) => outcome === "failed" || outcome === "unavailable");

describe("verifying the badges of Open Badges 2.0 that a script writes with jwcrypto", () => {
  it.each(FIXTURE.cases.map((badge) => [badge.name, badge] as const))("verifies %s", async (_name, badge) => {
    const { options } = optionsOf();
    const result = await verifyCredential(badge.input as string | object, options);
    const fails = FAILS[badge.outcome];
    expect(result.verified).toBe(fails === undefined);
    expect(failing(result)?.check).toBe(fails);
    if (fails === undefined) {
      expect(outcomes(result)).toStrictEqual({
        format: "passed",
        schema: "skipped",
        proof: "passed",
        issuer: "passed",
        refresh: "skipped",
        status: "passed",
        validity: "passed",
        recipient: "skipped",
      });
      expect((result.credential as BadgeAssertionV2).version).toBe("2.0");
    }
  });

  it("checks the recipient against the one that the verifier knows, by its hash, its plain value or its kind of 3.0", async () => {
    const valid = FIXTURE.cases.filter((badge) => badge.outcome === "valid");
    for (const identifier of [FIXTURE.recipient, { type: "emailAddress", value: FIXTURE.recipient.value }]) {
      const { options } = optionsOf(undefined, { recipient: { identifier } });
      for (const badge of valid) {
        expect(outcomes(await verifyCredential(badge.input as string | object, options)).recipient).toBe("passed");
      }
    }
    const { options } = optionsOf(undefined, {
      recipient: { identifier: { type: "email", value: "other@example.org" } },
    });
    const result = await verifyCredential(valid[0]?.input as string, options);
    expect(result).toMatchObject({ verified: false });
    expect(failing(result)?.check).toBe("recipient");
  });

  it("verifies what readPng and readSvg return for a 2.0 badge: an address, an assertion or a JWS", async () => {
    for (const badge of FIXTURE.cases.filter(({ outcome }) => outcome === "valid")) {
      const { options } = optionsOf();
      const result = await verifyCredential({ kind: "badge-v2", credential: badge.input }, options);
      expect(result.verified).toBe(true);
    }
  });

  it("fetches a signed badge's BadgeClass, issuer and key before its signature, and its revocation list only after it", async () => {
    const signed = FIXTURE.cases.filter(({ name }) => name.startsWith("a signed assertion"));
    const valid = optionsOf();
    await verifyCredential(signed[0]?.input as string, valid.options);
    expect(valid.requests).toStrictEqual([
      `${HOST}/badges/printmaster`,
      `${HOST}/issuer`,
      `${HOST}/keys/1`,
      `${HOST}/revocations`,
    ]);
    const changed = signed.find(({ outcome }) => outcome === "bad-signature");
    const forged = optionsOf();
    await verifyCredential(changed?.input as string, forged.options);
    expect(forged.requests).not.toContain(`${HOST}/revocations`);
    const unlisted = signed.find(({ outcome }) => outcome === "unlisted-key");
    const other = optionsOf();
    await verifyCredential(unlisted?.input as string, other.options);
    expect(other.requests).not.toContain(`${HOST}/keys/2`);
  });

  it("takes a hosted assertion, its BadgeClass and its issuer from their HTTPS ids, and not from what the input says", async () => {
    const hosted = FIXTURE.documents[`${HOST}/assertions/1`]?.body as Json;
    const changed = {
      ...hosted,
      badge: { id: `${HOST}/badges/printmaster`, name: "Another badge" },
      expires: "2099-01-01T00:00:00Z",
    };
    const { options, requests } = optionsOf();
    const result = await verifyCredential(changed, options);
    expect(result.verified).toBe(true);
    const credential = result.credential as BadgeAssertionV2;
    expect([credential.badge.name, credential.assertion.expires]).toStrictEqual(["3-D Printmaster", hosted.expires]);
    expect(requests).toStrictEqual([`${HOST}/assertions/1`, `${HOST}/badges/printmaster`, `${HOST}/issuer`]);
  });

  it("verifies a BadgeAssertionV2 that a host kept, at the id of its assertion", async () => {
    const { options } = optionsOf();
    const first = await verifyCredential(`${HOST}/assertions/1`, options);
    const again = await verifyCredential(JSON.parse(JSON.stringify(first.credential)), options);
    expect(again.verified).toBe(true);
    expect(again.credential).toStrictEqual(first.credential);
  });
});

describe("the failures of a 2.0 verification", () => {
  const hostedAddress = `${HOST}/assertions/1`;

  it("cannot verify a hosted assertion whose host does not answer, whatever the option unavailable says", async () => {
    for (const unavailable of ["fail", "warn"]) {
      const { options } = optionsOf({}, { unavailable });
      const result = await verifyCredential(hostedAddress, options);
      expect(result.verified).toBe(false);
      expect(outcomes(result).proof).toBe("unavailable");
    }
  });

  it("fails a hosted assertion whose document declares another id, and fetches nothing after it", async () => {
    const hosted = FIXTURE.documents[hostedAddress]?.body as Json;
    const { options, requests } = optionsOf({
      [hostedAddress]: { status: 200, body: { ...hosted, id: `${HOST}/assertions/9` } },
    });
    const result = await verifyCredential(hostedAddress, options);
    expect(failing(result)).toMatchObject({ check: "proof", outcome: "failed" });
    expect(requests).toStrictEqual([hostedAddress]);
  });

  it("fetches only HTTPS addresses that name a public host", async () => {
    const { options, requests } = optionsOf();
    for (const address of [
      "http://badges.example.org/assertions/1",
      "https://127.0.0.1/assertions/1",
      "https://[::1]/assertions/1",
      "https://intranet/assertions/1",
      "https://badges.internal/assertions/1",
    ]) {
      const result = await verifyCredential(address, options);
      expect(failing(result)).toMatchObject({ check: "format", outcome: "failed" });
    }
    const badgeClass = FIXTURE.documents[`${HOST}/badges/printmaster`]?.body as Json;
    const local = optionsOf({
      ...FIXTURE.documents,
      [`${HOST}/badges/printmaster`]: { status: 200, body: { ...badgeClass, issuer: "https://localhost/issuer" } },
    });
    const result = await verifyCredential(hostedAddress, local.options);
    expect(failing(result)).toMatchObject({ check: "format", outcome: "failed" });
    expect([...requests, ...local.requests]).toStrictEqual([hostedAddress, `${HOST}/badges/printmaster`]);
  });

  it("fails a signed assertion given as JSON or served at an address, whose signature is outside it", async () => {
    const signed = FIXTURE.cases.find(({ name }) => name === "a signed assertion");
    const payload = JSON.parse(Buffer.from(String(signed?.input).split(".")[1] ?? "", "base64url").toString()) as Json;
    const address = `${HOST}/assertions/signed`;
    const served = { ...payload, id: address };
    const { options, requests } = optionsOf({ ...FIXTURE.documents, [address]: { status: 200, body: served } });
    for (const input of [served, address]) {
      expect(failing(await verifyCredential(input, options))).toMatchObject({
        check: "format",
        outcome: "failed",
        detail: expect.stringContaining("not in a compact JWS"),
      });
    }
    expect(requests).toStrictEqual([address]);
  });

  it("fails a hosted assertion whose issuer's policy names a property other than id, the only one that 2.0 supports", async () => {
    const issuer = FIXTURE.documents[`${HOST}/issuer`]?.body as Json;
    const { options } = optionsOf({
      ...FIXTURE.documents,
      [`${HOST}/issuer`]: {
        status: 200,
        body: { ...issuer, verification: { type: "VerificationObject", verificationProperty: "url" } },
      },
    });
    expect(failing(await verifyCredential(hostedAddress, options))).toMatchObject({
      check: "issuer",
      outcome: "failed",
    });
  });

  it("fails an assertion issued later than the clock and its skew", async () => {
    const hosted = FIXTURE.documents[hostedAddress]?.body as Json;
    const { options } = optionsOf(undefined, { clock: clockAt(Date.parse(String(hosted.issuedOn)) - 3_600_000) });
    expect(failing(await verifyCredential(hostedAddress, options))).toMatchObject({
      check: "validity",
      outcome: "failed",
    });
  });

  it("judges a hosted assertion against the startsWith of its issuer at the address that URL resolves, so that dots or escapes leave no path", async () => {
    // Another tenant of the platform hosts a document that claims the guild's badge at an address that names the guild's path.
    const claimed = FIXTURE.documents["https://platform.example.com/assertions/acme/9"]?.body as Json;
    for (const address of [
      "https://platform.example.com/assertions/acme/../other/11",
      "https://platform.example.com/assertions/acme/%2e%2e/other/11",
      "https://platform.example.com/assertions/acme\\..\\other/11",
    ]) {
      const documents = {
        ...FIXTURE.documents,
        [new URL(address).href]: { status: 200, body: { ...claimed, id: address } },
      };
      const { options, requests } = optionsOf(documents);
      const served = async (input: RequestInfo | URL) => await options.fetch(new URL(String(input)).href);
      const result = await verifyCredential(address, { ...options, fetch: served });
      expect(requests[0], address).toBe("https://platform.example.com/assertions/other/11");
      expect(failing(result), address).toMatchObject({ check: "issuer", outcome: "failed" });
    }
  });

  it("fails a hosted assertion whose issuer is not at an HTTPS address, whose policy nothing ties to it", async () => {
    const badgeClass = FIXTURE.documents[`${HOST}/badges/printmaster`]?.body as Json;
    const issuer = FIXTURE.documents[`${HOST}/issuer`]?.body as Json;
    const embedded = { ...issuer, id: "urn:uuid:3f4ac4c2-55bd-4f63-a3f6-6b3a4c6f7e10" };
    const { options } = optionsOf({
      ...FIXTURE.documents,
      [`${HOST}/badges/printmaster`]: { status: 200, body: { ...badgeClass, issuer: embedded } },
    });
    expect(failing(await verifyCredential(hostedAddress, options))).toMatchObject({
      check: "issuer",
      outcome: "failed",
    });
  });

  it("fails a document that is not UTF-8", async () => {
    const served = host().fetch;
    const fetch = async (input: RequestInfo | URL) =>
      String(input) === `${HOST}/badges/printmaster` ? new Response(new Uint8Array([0x7b, 0xff, 0x7d])) : served(input);
    const { options } = optionsOf(undefined, { fetch });
    expect(failing(await verifyCredential(hostedAddress, options))).toMatchObject({
      check: "format",
      outcome: "failed",
      detail: expect.stringContaining("not UTF-8"),
    });
  });

  it("rejects with the reason of the signal when it aborts while a document is fetched", async () => {
    const controller = new AbortController();
    const reason = new Error("The host stopped waiting.");
    const fetch = async () => {
      controller.abort(reason);
      return await new Promise<Response>(() => undefined);
    };
    const { options } = optionsOf(undefined, { fetch, signal: controller.signal });
    await expect(verifyCredential(hostedAddress, options)).rejects.toBe(reason);
  });

  it("reads a revocation list that cannot be fetched as unavailable, which the option unavailable may accept", async () => {
    const signed = FIXTURE.cases.find(({ name }) => name === "a signed assertion");
    const { [`${HOST}/revocations`]: _list, ...documents } = FIXTURE.documents;
    for (const [unavailable, verified] of [
      ["fail", false],
      ["warn", true],
    ] as const) {
      const { options } = optionsOf(documents, { unavailable });
      const result = await verifyCredential(signed?.input as string, options);
      expect([result.verified, outcomes(result).status]).toStrictEqual([verified, "unavailable"]);
    }
  });
});

describe("signatures of 2.0 assertions that the issuer's documents do not back", () => {
  const ISSUER = "https://issuer.example.net/profile";
  const KEY = "https://issuer.example.net/keys/1";

  /** Signs an assertion with a new RSA key, and serves the documents of its issuer as given. */
  async function signedBadge(change: { issuer?: Json; key?: Json; header?: Json; verification?: Json } = {}) {
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const badgeClass = {
      "@context": "https://w3id.org/openbadges/v2",
      id: "https://issuer.example.net/badge",
      type: "BadgeClass",
      name: "Welding",
      description: "Welds.",
      image: "https://issuer.example.net/badge.png",
      criteria: { narrative: "Weld." },
      issuer: ISSUER,
    };
    const assertion = {
      "@context": "https://w3id.org/openbadges/v2",
      id: "urn:uuid:2f9d1c9e-0d36-4c4f-9a43-7f1e6e1c0a11",
      type: "Assertion",
      recipient: { type: "email", hashed: false, identity: "learner@example.org" },
      issuedOn: "2025-11-02T09:00:00Z",
      badge: badgeClass.id,
      verification: change.verification ?? { type: "SignedBadge", creator: KEY },
    };
    const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(assertion)))
      .setProtectedHeader({ alg: "RS256", ...change.header })
      .sign(privateKey);
    const issuer = {
      "@context": "https://w3id.org/openbadges/v2",
      id: ISSUER,
      type: "Issuer",
      name: "Guild",
      url: "https://issuer.example.net",
      email: "guild@example.net",
      publicKey: KEY,
      ...change.issuer,
    };
    const key = {
      "@context": "https://w3id.org/openbadges/v2",
      id: KEY,
      type: "CryptographicKey",
      owner: ISSUER,
      publicKeyPem: await exportSPKI(publicKey),
      ...change.key,
    };
    const documents = {
      [badgeClass.id]: { status: 200, body: badgeClass },
      [ISSUER]: { status: 200, body: issuer },
      [KEY]: { status: 200, body: key },
    };
    return { jws, documents };
  }

  it("verifies a signature by the key that the issuer lists", async () => {
    const { jws, documents } = await signedBadge();
    expect((await verifyCredential(jws, optionsOf(documents).options)).verified).toBe(true);
  });

  it("tries the keys of the issuer when the assertion names no creator", async () => {
    const { jws, documents } = await signedBadge({ verification: { type: "SignedBadge" } });
    expect((await verifyCredential(jws, optionsOf(documents).options)).verified).toBe(true);
  });

  it("fails a key that another profile owns, though the issuer lists it", async () => {
    const { jws, documents } = await signedBadge({ key: { owner: "https://elsewhere.example.net/profile" } });
    expect(failing(await verifyCredential(jws, optionsOf(documents).options))).toMatchObject({ check: "issuer" });
  });

  it("fails an algorithm that the verifier does not allow", async () => {
    const { jws, documents } = await signedBadge();
    const result = await verifyCredential(jws, optionsOf(documents, { algorithms: ["ES256"] }).options);
    expect(failing(result)).toMatchObject({ check: "proof", outcome: "failed" });
  });

  it("fails a JWS whose assertion says that it is hosted, and fetches nothing", async () => {
    const { jws, documents } = await signedBadge({ verification: { type: "HostedBadge" } });
    const { options, requests } = optionsOf(documents);
    expect(failing(await verifyCredential(jws, options))).toMatchObject({ check: "format", outcome: "failed" });
    expect(requests).toStrictEqual([]);
  });

  it("fails a JWS whose assertion does not say how it is verified", async () => {
    const { jws, documents } = await signedBadge({ verification: {} });
    expect(failing(await verifyCredential(jws, optionsOf(documents).options))).toMatchObject({
      check: "format",
      outcome: "failed",
    });
  });

  it("fails a key whose document declares another id than the address that the issuer lists", async () => {
    const { jws, documents } = await signedBadge({ key: { id: "https://issuer.example.net/keys/2" } });
    expect(failing(await verifyCredential(jws, optionsOf(documents).options))).toMatchObject({
      check: "proof",
      outcome: "failed",
    });
  });

  it("fails a JWS whose parts are not canonical base64url, though they decode to the bytes that were signed", async () => {
    const { jws, documents } = await signedBadge();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    // The signature of a key of 2,048 bits is 256 bytes, whose last character of base64url holds 4 bits that no byte uses.
    const last = alphabet.indexOf(jws.slice(-1));
    const changed = `${jws.slice(0, -1)}${alphabet[last | 1]}`;
    expect(Buffer.from(changed.split(".")[2] ?? "", "base64url")).toStrictEqual(
      Buffer.from(jws.split(".")[2] ?? "", "base64url"),
    );
    expect(failing(await verifyCredential(changed, optionsOf(documents).options))).toMatchObject({
      check: "proof",
      outcome: "failed",
    });
  });

  it("fails a JWS whose header is not UTF-8, which names no algorithm", async () => {
    const { jws, documents } = await signedBadge();
    const [, payload, signature] = jws.split(".");
    const changed = [Buffer.from([0xff]).toString("base64url"), payload, signature].join(".");
    expect(failing(await verifyCredential(changed, optionsOf(documents).options))).toMatchObject({
      check: "proof",
      outcome: "failed",
      detail: expect.stringContaining("names no algorithm"),
    });
  });

  it("fails a JWS whose header is longer than 16,384 characters, before it fetches a key", async () => {
    const { jws, documents } = await signedBadge();
    const [, payload, signature] = jws.split(".");
    const header = Buffer.from(JSON.stringify({ alg: "RS256", note: "a".repeat(12_300) })).toString("base64url");
    const { options, requests } = optionsOf(documents);
    expect(failing(await verifyCredential([header, payload, signature].join("."), options))).toMatchObject({
      check: "proof",
      outcome: "failed",
      detail: expect.stringContaining("names no algorithm"),
    });
    expect(requests).not.toContain(KEY);
  });

  it("fails a signed assertion without a creator whose issuer lists no key", async () => {
    const { jws, documents } = await signedBadge({
      verification: { type: "SignedBadge" },
      issuer: { publicKey: undefined },
    });
    expect(failing(await verifyCredential(jws, optionsOf(documents).options))).toMatchObject({
      check: "issuer",
      outcome: "failed",
      detail: expect.stringContaining("lists no key"),
    });
  });

  it("tries at most 8 keys of the issuer when the assertion names no creator", async () => {
    const { jws, documents } = await signedBadge({ verification: { type: "SignedBadge" } });
    const other = await generateKeyPair("RS256", { extractable: true });
    const otherPem = await exportSPKI(other.publicKey);
    const keys = Array.from({ length: 9 }, (_, index) => `https://issuer.example.net/keys/${index + 2}`);
    const served = Object.fromEntries(
      keys.map((id, index) => {
        const right = documents[KEY]?.body as Json;
        return [id, { status: 200, body: { ...right, id, ...(index < 8 ? { publicKeyPem: otherPem } : {}) } }];
      }),
    );
    const issuer = { ...(documents[ISSUER]?.body as Json), publicKey: keys };
    const { options, requests } = optionsOf({ ...documents, ...served, [ISSUER]: { status: 200, body: issuer } });
    expect(failing(await verifyCredential(jws, options))).toMatchObject({ check: "proof", outcome: "failed" });
    expect(requests.filter((url) => url.includes("/keys/"))).toStrictEqual(keys.slice(0, 8));
  });

  it("refuses a key of more than 8,192 bits before it verifies anything", async () => {
    const { jws, documents } = await signedBadge();
    const modulus = new Uint8Array(1025).fill(0xa5);
    modulus[0] = 0xc3;
    const large = await importJWK({ kty: "RSA", n: Buffer.from(modulus).toString("base64url"), e: "AQAB" }, "RS256", {
      extractable: true,
    });
    const key = { ...(documents[KEY]?.body as Json), publicKeyPem: await exportSPKI(large as CryptoKey) };
    const result = await verifyCredential(jws, optionsOf({ ...documents, [KEY]: { status: 200, body: key } }).options);
    expect(failing(result)).toMatchObject({ check: "proof", outcome: "failed" });
    expect(failing(result)?.detail).toContain("8192 bits");
  });

  it("fails an issuer that is not at an HTTPS address, whose keys nothing ties to it", async () => {
    const { jws, documents } = await signedBadge();
    const embedded = {
      ...documents,
      "https://issuer.example.net/badge": {
        status: 200,
        body: {
          ...(documents["https://issuer.example.net/badge"]?.body as Json),
          issuer: { ...(documents[ISSUER]?.body as Json), id: "urn:uuid:3f4ac4c2-55bd-4f63-a3f6-6b3a4c6f7e10" },
        },
      },
    };
    // The key names the issuer that the badge embeds as its owner, as whoever writes that issuer can make it.
    const key = { ...(documents[KEY]?.body as Json), owner: "urn:uuid:3f4ac4c2-55bd-4f63-a3f6-6b3a4c6f7e10" };
    const result = await verifyCredential(jws, optionsOf({ ...embedded, [KEY]: { status: 200, body: key } }).options);
    expect(failing(result)).toMatchObject({ check: "issuer", outcome: "failed" });
  });
});

describe("a 2.0 verification of documents of any content", () => {
  it("answers with a result, and never verifies a badge one of whose documents the host serves as anything else", async () => {
    const signed = FIXTURE.cases.find(({ name }) => name === "a signed assertion");
    const inputs = [signed?.input as string, `${HOST}/assertions/1`];
    const reads = await Promise.all(
      inputs.map(async (input) => {
        const { options, requests } = optionsOf();
        expect((await verifyCredential(input, options)).verified).toBe(true);
        return requests;
      }),
    );
    const addresses = [
      `${HOST}/badges/printmaster`,
      `${HOST}/issuer`,
      `${HOST}/keys/1`,
      `${HOST}/revocations`,
      `${HOST}/assertions/1`,
    ];
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...addresses),
        fc.jsonValue({ maxDepth: 4 }),
        fc.constantFrom(200, 410, 500),
        async (url, body, status) => {
          const documents = { ...FIXTURE.documents, [url]: { status, body } };
          for (const [index, input] of inputs.entries()) {
            const result = await verifyCredential(input, optionsOf(documents).options);
            expect(result.checks).toHaveLength(8);
            if (reads[index]?.includes(url)) expect(result.verified).toBe(false);
          }
        },
      ),
      { seed: 20_261_104, numRuns: 100 },
    );
  });
});
