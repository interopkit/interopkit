import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { DataError, signCompactJws, signerFromCryptoKey } from "@interopkit/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { readMultipart, writeMultipart } from "../src/attachments/index.js";
import { readStatement, type Statement } from "../src/index.js";
import {
  SIGNATURE_USAGE_TYPE,
  type SignatureCheck,
  signStatement,
  verifyStatementSignature,
} from "../src/signing/index.js";
import { copyOf, sharesNothing } from "./fixture.js";
import { minimalStatement } from "./full-statement.js";
import { sha2Of } from "./multipart.js";

interface Case {
  readonly title: string;
  readonly statement: Statement;
  readonly signature: string;
  readonly key?: string;
  readonly trust?: "root" | "nobody";
  readonly expected: SignatureCheck;
}

interface Fixture {
  readonly root: string;
  readonly keys: Readonly<Record<string, string>>;
  readonly cases: readonly Case[];
}

/** Signatures that jwcrypto made, with X.509 chains that cryptography made: `validation/xapi_signatures.py`. */
const fixture: Fixture = JSON.parse(readFileSync(new URL("./fixtures/xapi-signatures.json", import.meta.url), "utf8"));

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HASHES = { RS256: "SHA-256", RS384: "SHA-384", RS512: "SHA-512" } as const;
type Algorithm = keyof typeof HASHES;

/** The statement of the tests: a provider's, with an id and the time in UTC. */
function statementToSign(): Statement {
  return {
    id: "6690e6c9-3ef0-4ed3-8b37-7f3964730bee",
    ...minimalStatement(),
    timestamp: "2026-01-15T10:30:00.000Z",
  };
}

/** Makes an RSA key pair for the hash of an algorithm. */
function generateKeys(algorithm: Algorithm): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: HASHES[algorithm],
    },
    true,
    ["sign", "verify"],
  );
}

/** Imports the public key of a fixture, as a key made for the hash of an algorithm. */
async function importPublic(base64: string, algorithm: Algorithm): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: HASHES[algorithm] },
    false,
    ["verify"],
  );
}

const pairs = {} as Record<Algorithm, CryptoKeyPair>;
beforeAll(async () => {
  for (const algorithm of Object.keys(HASHES) as Algorithm[]) pairs[algorithm] = await generateKeys(algorithm);
});

describe("verifyStatementSignature on the signatures of jwcrypto", () => {
  it("has a case for each verdict, so that no case is missed", () => {
    expect(fixture.cases.length).toBeGreaterThan(30);
    const reasons = new Set(fixture.cases.map(({ expected }) => ("reason" in expected ? expected.reason : "good")));
    expect([...reasons].sort()).toStrictEqual([
      "algorithm",
      "good",
      "malformed",
      "no-key",
      "not-equivalent",
      "signature",
    ]);
  });

  it.each(fixture.cases.map((entry) => [entry.title, entry] as const))(
    "gives the verdict for %s",
    async (_title, entry) => {
      const header = entry.signature.split(".")[0] ?? "";
      const algorithm = (entry.key === "other" ? "RS256" : (entry.key ?? "RS256")) as Algorithm;
      const key =
        entry.key === undefined
          ? undefined
          : await importPublic(fixture.keys[entry.key === "other" ? "other" : "leaf"] as string, algorithm);
      expect(header).toBeTypeOf("string");
      const trustCertificate =
        entry.trust === undefined
          ? undefined
          : async (chain: readonly string[]) => entry.trust === "root" && chain.at(-1) === fixture.root;
      const options = {
        ...(key === undefined ? {} : { key }),
        ...(trustCertificate === undefined ? {} : { trustCertificate }),
      };
      expect(await verifyStatementSignature(entry.statement, encoder.encode(entry.signature), options)).toStrictEqual(
        entry.expected,
      );
    },
  );
});

describe("signStatement", () => {
  it.each(Object.keys(HASHES) as Algorithm[])(
    "signs a Statement with %s so that an independent implementation verifies it",
    async (algorithm) => {
      const signer = signerFromCryptoKey(pairs[algorithm].privateKey, { algorithm });
      const statement = statementToSign();
      const signed = await signStatement(statement, signer);

      const jws = decoder.decode(signed.signature.body);
      const [header, payload, signature] = jws.split(".") as [string, string, string];
      expect(JSON.parse(atob(header.replace(/-/gu, "+").replace(/_/gu, "/")))).toStrictEqual({ alg: algorithm });
      expect(
        decoder.decode(Uint8Array.from(atob(payload.replace(/-/gu, "+").replace(/_/gu, "/")), (c) => c.charCodeAt(0))),
      ).toBe(JSON.stringify(statement));
      // OpenSSL, through node:crypto, shares no code with Web Crypto, which made the signature.
      const spki = Buffer.from(await crypto.subtle.exportKey("spki", pairs[algorithm].publicKey));
      const rawSignature = Buffer.from(signature.replace(/-/gu, "+").replace(/_/gu, "/"), "base64");
      expect(
        verify(
          `sha${algorithm.slice(2)}`,
          encoder.encode(`${header}.${payload}`),
          createPublicKey({ key: spki, format: "der", type: "spki" }),
          rawSignature,
        ),
      ).toBe(true);
    },
  );

  it("adds the header of the signature to the attachments, and returns the signature as the data of that Attachment", async () => {
    const signed = await signStatement(
      statementToSign(),
      signerFromCryptoKey(pairs.RS256.privateKey, { algorithm: "RS256" }),
    );
    expect(signed.statement).toStrictEqual({
      ...statementToSign(),
      attachments: [
        {
          usageType: "http://adlnet.gov/expapi/attachments/signature",
          display: { "en-US": "Signature" },
          contentType: "application/octet-stream",
          length: signed.signature.body.byteLength,
          sha2: sha2Of(signed.signature.body),
        },
      ],
    });
    expect(SIGNATURE_USAGE_TYPE).toBe("http://adlnet.gov/expapi/attachments/signature");
    expect(signed.signature).toStrictEqual({
      sha2: sha2Of(signed.signature.body),
      contentType: "application/octet-stream",
      body: signed.signature.body,
    });
  });

  it("puts the signature after the Attachments that the Statement has, and signs the Statement without it", async () => {
    const statement: Statement = {
      ...statementToSign(),
      attachments: [
        {
          usageType: "https://example.org/attachments/usage",
          display: { "en-US": "Certificate" },
          contentType: "image/png",
          length: 3,
          sha2: sha2Of("png"),
          fileUrl: "https://example.org/certificate.png",
        },
      ],
    };
    const signed = await signStatement(statement, signerFromCryptoKey(pairs.RS256.privateKey, { algorithm: "RS256" }));
    expect(signed.statement.attachments).toHaveLength(2);
    expect(signed.statement.attachments?.[0]).toStrictEqual(statement.attachments?.[0]);
    expect(signed.statement.attachments?.[1]?.usageType).toBe(SIGNATURE_USAGE_TYPE);
    const payload = decoder.decode(
      Uint8Array.from(
        atob((decoder.decode(signed.signature.body).split(".")[1] ?? "").replace(/-/gu, "+").replace(/_/gu, "/")),
        (c) => c.charCodeAt(0),
      ),
    );
    expect(JSON.parse(payload)).toStrictEqual(statement);
  });

  it("writes the key id of the signer as kid and the chain as x5c", async () => {
    const signer = signerFromCryptoKey(pairs.RS256.privateKey, {
      algorithm: "RS256",
      keyId: "https://example.org/keys/1",
    });
    const chain = [btoa("leaf certificate"), btoa("root certificate!")];
    const { signature } = await signStatement(statementToSign(), signer, { x5c: chain });
    const header = JSON.parse(
      atob((decoder.decode(signature.body).split(".")[0] ?? "").replace(/-/gu, "+").replace(/_/gu, "/")),
    );
    expect(header).toStrictEqual({ alg: "RS256", kid: "https://example.org/keys/1", x5c: chain });
  });

  it("gives the same signature for the same Statement and key, since RSA PKCS#1 v1.5 is deterministic", async () => {
    const signer = signerFromCryptoKey(pairs.RS384.privateKey, { algorithm: "RS384" });
    const first = await signStatement(statementToSign(), signer);
    expect(await signStatement(statementToSign(), signer)).toStrictEqual(first);
  });

  it("changes nothing of its input and shares nothing with it", async () => {
    const statement = statementToSign();
    const before = copyOf(statement);
    const signed = await signStatement(statement, signerFromCryptoKey(pairs.RS256.privateKey, { algorithm: "RS256" }));
    expect(statement).toStrictEqual(before);
    expect(sharesNothing(statement, signed.statement)).toBe(true);
  });

  it("makes a Statement that a provider may send and that verifies against the key", async () => {
    const signed = await signStatement(
      statementToSign(),
      signerFromCryptoKey(pairs.RS512.privateKey, { algorithm: "RS512" }),
    );
    expect(readStatement(signed.statement, { role: "provider" })).toStrictEqual(signed.statement);
    expect(
      await verifyStatementSignature(signed.statement, signed.signature.body, { key: pairs.RS512.publicKey }),
    ).toStrictEqual({
      valid: true,
      certified: false,
    });
  });

  it("makes a message that writeMultipart writes and readMultipart reads, with the signature as an Attachment", async () => {
    const signed = await signStatement(
      statementToSign(),
      signerFromCryptoKey(pairs.RS256.privateKey, { algorithm: "RS256" }),
    );
    const written = writeMultipart(signed.statement, [signed.signature]);
    const { parts } = readMultipart(written.contentType, written.body);
    expect(parts.get(signed.signature.sha2)).toStrictEqual(signed.signature);
  });

  describe("input that cannot be signed", () => {
    const signer = () => signerFromCryptoKey(pairs.RS256.privateKey, { algorithm: "RS256" });

    it("refuses a Statement that breaks a rule of a provider, and one that has a signature already", async () => {
      await expect(signStatement({ actor: {} } as never, signer())).rejects.toThrow("The statement is invalid");
      await expect(
        signStatement({ ...statementToSign(), timestamp: "2026-01-15T10:30:00+02:00" }, signer()),
      ).rejects.toThrow(DataError);
      const signed = await signStatement(statementToSign(), signer());
      await expect(signStatement(signed.statement, signer())).rejects.toThrow(
        "The Statement has a signature already: a Statement is signed once.",
      );
    });

    it.each(["ES256", "PS256", "EdDSA", "HS256", "none"])("refuses a signer of %s", async (algorithm) => {
      await expect(
        signStatement(statementToSign(), { algorithm, sign: async () => new Uint8Array(64) }),
      ).rejects.toThrow(
        `The signature of a Statement is RS256, RS384 or RS512, and the signer signs with "${algorithm}".`,
      );
    });

    it("refuses what is not a signer", async () => {
      for (const value of [JSON.parse("null"), JSON.parse("5"), JSON.parse("[]")]) {
        await expect(signStatement(statementToSign(), value)).rejects.toThrow(/^The signer must be an object, found /);
      }
      await expect(signStatement(statementToSign(), JSON.parse('{"algorithm":"RS256"}'))).rejects.toThrow(DataError);
      await expect(signStatement(statementToSign(), JSON.parse('{"algorithm":5}'))).rejects.toThrow(
        "The signature of a Statement is RS256, RS384 or RS512, and the signer signs with 5.",
      );
    });

    it.each([
      [null, "The options object is invalid: expected an object, found null."],
      [[], "The options object is invalid: expected an object, found an array."],
      [{ x5c: [] }, "The options object is invalid at x5c: expected a length of at least 1, found 0."],
      [{ x5c: "AAAA" }, 'The options object is invalid at x5c: expected an array, found "AAAA".'],
      [
        { x5c: ["not base64!"] },
        "The options object is invalid at x5c[0]: expected a certificate as the base64 of its DER encoding",
      ],
      [{ x5c: ["AAA"] }, "The options object is invalid at x5c[0]: expected a certificate"],
      [{ x5c: ["A==="] }, "The options object is invalid at x5c[0]: expected a certificate"],
      [{ x5c: ["AA=A"] }, "The options object is invalid at x5c[0]: expected a certificate"],
      [{ x5c: [5] }, "The options object is invalid at x5c[0]: expected a string, found 5."],
      [{ signal: {} }, "The options object is invalid at signal: expected an AbortSignal, found an object."],
      [{ chain: [] }, 'The options object is invalid: unexpected property "chain".'],
    ])("refuses the options %j", async (options, sentence) => {
      await expect(signStatement(statementToSign(), signer(), JSON.parse(JSON.stringify(options)))).rejects.toThrow(
        DataError,
      );
      await expect(signStatement(statementToSign(), signer(), JSON.parse(JSON.stringify(options)))).rejects.toThrow(
        sentence,
      );
    });
  });

  describe("a signer that fails or a caller that gives up", () => {
    it("rejects with the error of the signer and returns nothing half signed", async () => {
      const failing = { algorithm: "RS256", sign: () => Promise.reject(new Error("the KMS is down")) };
      await expect(signStatement(statementToSign(), failing)).rejects.toThrow("the KMS is down");
    });

    it("refuses a signature of the wrong form from the signer", async () => {
      const wrong = { algorithm: "RS256", sign: async () => JSON.parse('"text"') };
      await expect(signStatement(statementToSign(), wrong)).rejects.toThrow(DataError);
    });

    it("gives the signer the signal, and rejects with its reason when it aborts before or during the call", async () => {
      const controller = new AbortController();
      let received: AbortSignal | undefined;
      const pending = {
        algorithm: "RS256",
        sign: (_data: Uint8Array, options?: { signal?: AbortSignal }) => {
          received = options?.signal;
          return new Promise<Uint8Array>(() => {});
        },
      };
      const running = signStatement(statementToSign(), pending, { signal: controller.signal });
      await vi.waitFor(() => expect(received).toBe(controller.signal));
      controller.abort(new Error("gave up"));
      await expect(running).rejects.toThrow("gave up");
      await expect(
        signStatement(statementToSign(), pending, { signal: AbortSignal.abort(new Error("before")) }),
      ).rejects.toThrow("before");
    });
  });
});

describe("verifyStatementSignature", () => {
  const signedBy = async (algorithm: Algorithm, header: Record<string, unknown> = {}, payload?: Uint8Array) =>
    encoder.encode(
      await signCompactJws(
        header,
        payload ?? encoder.encode(JSON.stringify(statementToSign())),
        signerFromCryptoKey(pairs[algorithm].privateKey, { algorithm }),
      ),
    );

  it("verifies a signature that signStatement made, with RS256, RS384 and RS512", async () => {
    for (const algorithm of Object.keys(HASHES) as Algorithm[]) {
      const signed = await signStatement(
        statementToSign(),
        signerFromCryptoKey(pairs[algorithm].privateKey, { algorithm }),
      );
      expect(
        await verifyStatementSignature(signed.statement, signed.signature.body, { key: pairs[algorithm].publicKey }),
      ).toStrictEqual({ valid: true, certified: false });
    }
  });

  it("refuses a Statement that is no longer the one that was signed, in any property that equivalence counts", async () => {
    const signed = await signStatement(
      statementToSign(),
      signerFromCryptoKey(pairs.RS256.privateKey, { algorithm: "RS256" }),
    );
    const other = { ...signed.statement, verb: { id: "http://adlnet.gov/expapi/verbs/failed" } };
    expect(await verifyStatementSignature(other, signed.signature.body, { key: pairs.RS256.publicKey })).toStrictEqual({
      valid: false,
      reason: "not-equivalent",
    });
  });

  it("accepts a Statement with what the LRS added", async () => {
    const signed = await signStatement(
      statementToSign(),
      signerFromCryptoKey(pairs.RS256.privateKey, { algorithm: "RS256" }),
    );
    const stored = {
      ...signed.statement,
      stored: "2026-01-15T10:31:00.000Z",
      authority: { account: { homePage: "https://lrs.example.org", name: "client" } },
      version: "2.0.0",
    };
    expect(await verifyStatementSignature(stored, signed.signature.body, { key: pairs.RS256.publicKey })).toStrictEqual(
      {
        valid: true,
        certified: false,
      },
    );
  });

  describe("what a signature keeps, which the equivalence of Statements leaves out", () => {
    const signer = () => signerFromCryptoKey(pairs.RS256.privateKey, { algorithm: "RS256" });
    const verify = (statement: Statement, signature: Uint8Array) =>
      verifyStatementSignature(statement, signature, { key: pairs.RS256.publicKey });
    const attachment = {
      usageType: "https://example.org/usage/certificate",
      display: { en: "Certificate" },
      contentType: "text/plain",
      length: 1,
      sha2: "a".repeat(64),
      fileUrl: "https://example.org/certificate",
    };

    it("refuses another id than the one that was signed", async () => {
      const { statement, signature } = await signStatement(statementToSign(), signer());
      const changed = { ...statement, id: "00000000-0000-4000-8000-000000000001" };
      expect(await verify(changed, signature.body)).toStrictEqual({ valid: false, reason: "not-equivalent" });
    });

    it("refuses another time than the one that was signed, and takes the same time in another zone", async () => {
      const timed = { ...statementToSign(), timestamp: "2024-06-13T18:46:03.250Z" };
      const { statement, signature } = await signStatement(timed, signer());
      const later = { ...statement, timestamp: "2024-06-13T18:46:04.250Z" };
      expect(await verify(later, signature.body)).toStrictEqual({ valid: false, reason: "not-equivalent" });
      const gone = { ...statement, timestamp: undefined };
      delete gone.timestamp;
      expect(await verify(gone, signature.body)).toStrictEqual({ valid: false, reason: "not-equivalent" });
      const zoned = { ...statement, timestamp: "2024-06-13T20:46:03.250+02:00" };
      expect((await verify(zoned, signature.body)).valid).toBe(true);
    });

    it("refuses a Statement that lost or changed an Attachment that was signed", async () => {
      const { statement, signature } = await signStatement(
        { ...statementToSign(), attachments: [attachment] },
        signer(),
      );
      const [header, signatureHeader] = statement.attachments ?? [];
      const swapped = { ...statement, attachments: [{ ...attachment, sha2: "b".repeat(64) }, signatureHeader] };
      expect(await verify(swapped as Statement, signature.body)).toStrictEqual({
        valid: false,
        reason: "not-equivalent",
      });
      expect(header?.sha2).toBe(attachment.sha2);
      const lost = { ...statement, attachments: [signatureHeader] };
      expect(await verify(lost as Statement, signature.body)).toStrictEqual({ valid: false, reason: "not-equivalent" });
      expect((await verify(statement, signature.body)).valid).toBe(true);
    });

    it("refuses the same changes when no key is at hand", async () => {
      const { statement, signature } = await signStatement(statementToSign(), signer());
      const changed = { ...statement, id: "00000000-0000-4000-8000-000000000001" };
      expect(await verifyStatementSignature(changed, signature.body)).toStrictEqual({
        valid: false,
        reason: "not-equivalent",
      });
    });

    it("takes an id that the LRS gave a Statement that was signed with none", async () => {
      const { id: _id, ...anonymous } = statementToSign();
      const { statement, signature } = await signStatement(anonymous, signer());
      const stored = { ...statement, id: "00000000-0000-4000-8000-000000000001" };
      expect((await verify(stored, signature.body)).valid).toBe(true);
    });
  });

  it("does not use a key that the JWS carries, since its signer chose it", async () => {
    const { privateKey, publicKey } = pairs.RS256;
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    const signature = await signedBy("RS256", { jwk });
    expect(await verifyStatementSignature(statementToSign(), signature)).toStrictEqual({
      valid: false,
      reason: "no-key",
    });
    expect(privateKey.type).toBe("private");
  });

  it("reads the payload of a signature that it has no key for, and says no-key only when it is the Statement given", async () => {
    const good = await signedBy("RS256");
    const sections = new TextDecoder().decode(good).split(".");
    const encode = (text: string) => Buffer.from(text).toString("base64url");
    const rejoined = (payload: string) => new TextEncoder().encode(`${sections[0]}.${payload}.${sections[2]}`);
    const verdict = (signature: Uint8Array) => verifyStatementSignature(statementToSign(), signature);
    expect(await verdict(good)).toStrictEqual({ valid: false, reason: "no-key" });
    // A payload that is not JSON, one that is not a Statement, and one that is another Statement.
    expect(await verdict(rejoined(encode("{'actor':1}")))).toStrictEqual({ valid: false, reason: "malformed" });
    expect(await verdict(rejoined(encode('{"actor":1}')))).toStrictEqual({ valid: false, reason: "malformed" });
    expect(
      await verdict(
        rejoined(encode(JSON.stringify({ ...statementToSign(), verb: { id: "https://example.org/other" } }))),
      ),
    ).toStrictEqual({
      valid: false,
      reason: "not-equivalent",
    });
    // A JWS of two sections, and one whose payload is no base64url.
    expect(await verdict(new TextEncoder().encode(`${sections[0]}.${sections[1]}`))).toStrictEqual({
      valid: false,
      reason: "malformed",
    });
    expect(await verdict(rejoined("***"))).toStrictEqual({ valid: false, reason: "malformed" });
    expect(await verdict(rejoined("abcde"))).toStrictEqual({ valid: false, reason: "malformed" });
  });

  it("refuses a key made for another hash than the algorithm of the JWS", async () => {
    const signature = await signedBy("RS256");
    expect(await verifyStatementSignature(statementToSign(), signature, { key: pairs.RS384.publicKey })).toStrictEqual({
      valid: false,
      reason: "algorithm",
    });
  });

  it("refuses a key of less than 2,048 bits, which no algorithm of the series accepts", async () => {
    const weak = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 1024, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const signed = await signStatement(statementToSign(), signerFromCryptoKey(weak.privateKey, { algorithm: "RS256" }));
    expect(
      await verifyStatementSignature(signed.statement, signed.signature.body, { key: weak.publicKey }),
    ).toStrictEqual({
      valid: false,
      reason: "algorithm",
    });
  });

  it("calls the header malformed when the extension it requires is not understood", async () => {
    const signature = await signedBy("RS256", { crit: ["exp"], exp: 1 });
    expect(await verifyStatementSignature(statementToSign(), signature, { key: pairs.RS256.publicKey })).toStrictEqual({
      valid: false,
      reason: "malformed",
    });
  });

  it("calls the payload malformed when it is not UTF-8, not JSON, repeats a property, or is not a Statement", async () => {
    const payloads = [
      Uint8Array.from([0xff, 0xfe]),
      encoder.encode("not json"),
      encoder.encode('{"id":"6690e6c9-3ef0-4ed3-8b37-7f3964730bee","id":"6690e6c9-3ef0-4ed3-8b37-7f3964730bee"}'),
      encoder.encode('{"hello":"world"}'),
    ];
    for (const payload of payloads) {
      const signature = await signedBy("RS256", {}, payload);
      expect(
        await verifyStatementSignature(statementToSign(), signature, { key: pairs.RS256.publicKey }),
      ).toStrictEqual({
        valid: false,
        reason: "malformed",
      });
    }
  });

  it("calls the signature malformed when its bytes are not UTF-8", async () => {
    expect(await verifyStatementSignature(statementToSign(), Uint8Array.from([0xff, 0xfe, 0x2e]))).toStrictEqual({
      valid: false,
      reason: "malformed",
    });
  });

  describe("the trust function", () => {
    const entry = fixture.cases[0] as Case;
    const chainOf = (token: string): readonly string[] =>
      JSON.parse(atob((token.split(".")[0] ?? "").replace(/-/gu, "+").replace(/_/gu, "/"))).x5c;

    it("verifies with the key that the caller gives and never with a chain that the signer chose", async () => {
      const good = fixture.cases[0] as { statement: Statement; signature: string };
      const body = new TextEncoder().encode(good.signature);
      const { statement } = good;
      expect((await verifyStatementSignature(statement, body)).valid).toBe(true);
      expect(await verifyStatementSignature(statement, body, { key: pairs.RS256.publicKey })).toStrictEqual({
        valid: false,
        reason: "signature",
      });
    });

    it("receives the chain of the header, leaf first, and the signal of the call", async () => {
      const controller = new AbortController();
      const calls: unknown[][] = [];
      const trustCertificate = async (...args: unknown[]) => {
        calls.push(args);
        return true;
      };
      const result = await verifyStatementSignature(entry.statement, encoder.encode(entry.signature), {
        trustCertificate,
        signal: controller.signal,
      });
      expect(result).toStrictEqual({ valid: true, certified: true });
      expect(calls).toStrictEqual([[chainOf(entry.signature), { signal: controller.signal }]]);
    });

    it("is not asked about a chain that does not verify the signature", async () => {
      const trustCertificate = vi.fn(async () => true);
      const bad = fixture.cases.find(({ title }) => title === "a signature with a bit changed") as Case;
      expect(
        await verifyStatementSignature(bad.statement, encoder.encode(bad.signature), { trustCertificate }),
      ).toStrictEqual({
        valid: false,
        reason: "signature",
      });
      expect(trustCertificate).not.toHaveBeenCalled();
    });

    it("is not asked when there is no chain", async () => {
      const trustCertificate = vi.fn(async () => true);
      const signature = await signedBy("RS256");
      expect(
        await verifyStatementSignature(statementToSign(), signature, { key: pairs.RS256.publicKey, trustCertificate }),
      ).toStrictEqual({ valid: true, certified: false });
      expect(trustCertificate).not.toHaveBeenCalled();
    });

    it("rejects with its error, and ends the wait when the signal aborts", async () => {
      await expect(
        verifyStatementSignature(entry.statement, encoder.encode(entry.signature), {
          trustCertificate: () => Promise.reject(new Error("the trust store is down")),
        }),
      ).rejects.toThrow("the trust store is down");
      const controller = new AbortController();
      const waiting = verifyStatementSignature(entry.statement, encoder.encode(entry.signature), {
        trustCertificate: () => new Promise<boolean>(() => {}),
        signal: controller.signal,
      });
      controller.abort(new Error("gave up"));
      await expect(waiting).rejects.toThrow("gave up");
    });
  });

  describe("input that is not valid", () => {
    it("throws for a Statement that an LRS would refuse, and for a signature that is not bytes", async () => {
      await expect(verifyStatementSignature({ actor: {} } as never, new Uint8Array())).rejects.toThrow(
        "The statement is invalid",
      );
      for (const value of [JSON.parse('"jws"'), JSON.parse("null"), JSON.parse("[1]")]) {
        await expect(verifyStatementSignature(statementToSign(), value)).rejects.toThrow(
          /^The signature must be a Uint8Array, found /,
        );
      }
    });

    it("rejects with the reason of a signal that has aborted", async () => {
      await expect(
        verifyStatementSignature(statementToSign(), new Uint8Array(), {
          signal: AbortSignal.abort(new Error("before")),
        }),
      ).rejects.toThrow("before");
    });

    it("throws for a key that cannot verify an RSA signature", async () => {
      const ecdsa = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      const hmac = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
      for (const key of [pairs.RS256.privateKey, ecdsa.publicKey, hmac]) {
        await expect(verifyStatementSignature(statementToSign(), new Uint8Array(), { key })).rejects.toThrow(
          /^The options object is invalid at key: expected a public RSASSA-PKCS1-v1_5 CryptoKey that can verify, found /,
        );
      }
    });

    it.each([
      [null, "The options object is invalid: expected an object, found null."],
      [
        { trustCertificate: "yes" },
        'The options object is invalid at trustCertificate: expected a function, found "yes".',
      ],
      [{ signal: 5 }, "The options object is invalid at signal: expected an AbortSignal, found 5."],
      [{ certificates: [] }, 'The options object is invalid: unexpected property "certificates".'],
    ])("throws for the options %j", async (options, sentence) => {
      await expect(
        verifyStatementSignature(statementToSign(), new Uint8Array(), JSON.parse(JSON.stringify(options))),
      ).rejects.toThrow(new DataError(sentence));
    });
  });

  it("does not hide an error of the reader that is not about the payload", async () => {
    const signature = await signedBy("RS256");
    vi.resetModules();
    vi.doMock("../src/read/index.js", async (importOriginal) => {
      const original = await importOriginal<typeof import("../src/read/index.js")>();
      let calls = 0;
      return {
        ...original,
        // The first call reads the Statement that the caller gave, and the second the payload.
        readStatement: (value: unknown, options?: never) => {
          calls += 1;
          if (calls === 2) throw new TypeError("a defect of the reader");
          return original.readStatement(value, options);
        },
      };
    });
    try {
      const { verifyStatementSignature: withBrokenReader } = await import("../src/signing/index.js");
      await expect(withBrokenReader(statementToSign(), signature, { key: pairs.RS256.publicKey })).rejects.toThrow(
        new TypeError("a defect of the reader"),
      );
    } finally {
      vi.doUnmock("../src/read/index.js");
      vi.resetModules();
    }
  });
});
