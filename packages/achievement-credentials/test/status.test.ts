import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  allocateStatusIndex,
  createStatusList,
  createStatusListCache,
  issueStatusListCredential,
  setCredentialStatus,
  verifyCredentialStatus,
} from "../src/status/index.js";
import { decodeList, encodeList, isSet } from "../src/status/internal.js";
import { memoryContexts } from "./context-fixtures.js";
import { abortsWhileWaiting, hangingPort } from "./hanging-port.js";
import { HOSTILE, neverParsesLarge } from "./hostile.js";
import { clockAt, KEYS, signerOf } from "./key-fixtures.js";
import {
  attacker,
  credentialWithStatus,
  ISSUER,
  LIST_URL,
  listJws,
  listWith,
  METHOD,
  NOW,
  signer,
  world,
} from "./status-fixtures.js";

const status = (entry: Record<string, unknown> = {}, routes: Record<string, unknown> = {}, issuer = ISSUER) => {
  const w = world(routes);
  return {
    w,
    run: (options: object = {}) =>
      verifyCredentialStatus(credentialWithStatus(entry, issuer), { ...w.options, ...options }),
  };
};

describe("a status list", () => {
  it("has 131,072 entries by default, all clear, and entry 0 is the most significant bit of the first byte", () => {
    const list = createStatusList();
    expect(list.length).toBe(131_072);
    expect(list.bits.byteLength).toBe(16_384);
    expect(list.bits.every((byte) => byte === 0)).toBe(true);
    const set = setCredentialStatus(setCredentialStatus(list, 0, true), 9, true);
    expect([set.bits[0], set.bits[1]]).toStrictEqual([0x80, 0x40]);
    expect(setCredentialStatus(set, 0, false).bits[0]).toBe(0);
    expect(isSet(set.bits, 9)).toBe(true);
    expect(isSet(set.bits, 8)).toBe(false);
  });

  it("is never changed by setting an entry: a new list is returned", () => {
    const list = createStatusList();
    const set = setCredentialStatus(list, 5, true);
    expect(set).not.toBe(list);
    expect(set.bits).not.toBe(list.bits);
    expect(list.bits[0]).toBe(0);
  });

  it("can be longer, in a multiple of 8", () => {
    expect(createStatusList({ length: 262_144 }).bits.byteLength).toBe(32_768);
  });

  it.each([
    ["a length below the least", { length: 8 }],
    ["a length that is not a multiple of 8", { length: 131_073 }],
    ["a length above the most", { length: 134_217_736 }],
    ["a length that is a fraction", { length: 131_072.5 }],
    ["options that are null", null],
  ])("is refused for %s", (_name, options) => {
    expect(() => createStatusList(JSON.parse(JSON.stringify(options)))).toThrow(DataError);
  });

  it("is refused to be set at an index outside it, or with arguments of the wrong type", () => {
    const list = createStatusList();
    expect(() => setCredentialStatus(list, 131_072, true)).toThrow(DataError);
    expect(() => setCredentialStatus(list, -1, true)).toThrow(DataError);
    expect(() => setCredentialStatus(JSON.parse("null"), 0, true)).toThrow(DataError);
    expect(() => setCredentialStatus({ length: 8, bits: new Uint8Array(1) }, 0, true)).toThrow(DataError);
    expect(() => setCredentialStatus(list, 0, JSON.parse('"yes"'))).toThrow(DataError);
    expect(() => setCredentialStatus({ length: 131_072, bits: new Uint8Array(1) }, 0, true)).toThrow("16384 bytes");
  });
});

describe("the index that a credential gets", () => {
  const fixed = (draw: number) => () => draw;

  it("is the n-th free index for a draw, so that every free index has the same chance", () => {
    const used = new Set([0, 1, 2, 5]);
    // Free indexes of a list of 8: 3, 4, 6, 7.
    const picks = [0.1, 0.3, 0.6, 0.9].map((draw) => allocateStatusIndex(used, { length: 8, random: fixed(draw) }));
    expect(picks).toStrictEqual([3, 4, 6, 7]);
  });

  it("is never a taken index, and covers all the free ones, for any set of taken indexes", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.nat(63), { maxLength: 63 }), (taken) => {
        const used = new Set(taken);
        const free = Array.from({ length: 64 }, (_, index) => index).filter((index) => !used.has(index));
        const found = free.map((_, k) =>
          allocateStatusIndex(used, { length: 64, random: fixed((k + 0.5) / free.length) }),
        );
        expect(found).toStrictEqual(free);
      }),
      { seed: 20_241_107, numRuns: 100 },
    );
  });

  it("is refused when the list is full, or an argument is not valid", () => {
    const full = new Set([0, 1, 2, 3]);
    expect(() => allocateStatusIndex(full, { length: 4, random: fixed(0.5) })).toThrow("no free index");
    expect(() => allocateStatusIndex(new Set([4]), { length: 4, random: fixed(0.5) })).toThrow(DataError);
    expect(() => allocateStatusIndex(new Set([0.5]), { length: 4, random: fixed(0.5) })).toThrow(DataError);
    expect(() => allocateStatusIndex(JSON.parse("[]"), { length: 4, random: fixed(0.5) })).toThrow(DataError);
    expect(() => allocateStatusIndex(new Set(), { length: 4, random: JSON.parse("null") })).toThrow(DataError);
    expect(() => allocateStatusIndex(new Set(), { length: 4, random: fixed(1) })).toThrow("from 0 up to 1");
    expect(() => allocateStatusIndex(new Set(), { length: 4, random: fixed(Number.NaN) })).toThrow(DataError);
    expect(() => allocateStatusIndex(new Set(), JSON.parse("null"))).toThrow(DataError);
  });
});

describe("the encoded list", () => {
  it("is GZIP and multibase base64url, and decodes to the bits it was made from", async () => {
    const list = listWith(1, 94_567);
    const encoded = await encodeList(list);
    expect(encoded.startsWith("u")).toBe(true);
    const decoded = await decodeList(encoded);
    expect("bits" in decoded && decoded.bits).toStrictEqual(list.bits);
  });

  it("is refused when it is not multibase base64url, not base64url, not GZIP, or inflates past the limit", async () => {
    expect(await decodeList(5)).toMatchObject({ reason: expect.stringContaining("multibase") });
    expect(await decodeList("x-abc")).toMatchObject({ reason: expect.stringContaining("multibase") });
    expect(await decodeList("u!!!")).toMatchObject({ reason: expect.stringContaining("base64url") });
    expect(await decodeList("uAAAA")).toMatchObject({ reason: expect.stringContaining("GZIP") });
    const encoded = await encodeList(createStatusList());
    expect(await decodeList(encoded, 16_383)).toMatchObject({
      reason: expect.stringContaining("inflates to more than"),
    });
    expect(await decodeList(encoded, 16_384)).toHaveProperty("bits");
  });
});

describe("issuing a status list credential", () => {
  it("is a compact JWS by default, which the key of the signer verifies and the issuer binds", async () => {
    const jws = await listJws(listWith(3));
    expect(jws.split(".")).toHaveLength(3);
    const w = world();
    const { readCredentialJwt } = await import("../src/jwt/index.js");
    const result = await readCredentialJwt(jws, { keys: w.keys, clock: w.clock });
    expect(result).toMatchObject({
      valid: true,
      bound: true,
      credential: {
        id: LIST_URL,
        type: ["VerifiableCredential", "BitstringStatusListCredential"],
        credentialSubject: { type: "BitstringStatusList", statusPurpose: "revocation" },
      },
    });
  });

  it("can carry a Data Integrity proof, and states the dates and the ttl", async () => {
    const edKey = KEYS.ed25519;
    const did = `did:key:${edKey.multikey}`;
    const issued = await issueStatusListCredential(
      {
        id: LIST_URL,
        issuer: did,
        validFrom: "2024-06-14T00:00:00Z",
        validUntil: "2025-06-14T00:00:00Z",
        ttlMilliseconds: 60_000,
        purpose: "suspension",
        list: listWith(),
      },
      signerOf(edKey, `${did}#${edKey.multikey}`),
      { proof: "data-integrity", contexts: memoryContexts().load, clock: clockAt(NOW) },
    );
    expect(issued).toMatchObject({
      validUntil: "2025-06-14T00:00:00Z",
      credentialSubject: { statusPurpose: "suspension", ttl: 60_000 },
      proof: [{ cryptosuite: "eddsa-rdfc-2022", verificationMethod: `${did}#${edKey.multikey}` }],
    });
  });

  it("is refused for options and input of the wrong type, and a signer without a key", async () => {
    const input = {
      id: LIST_URL,
      issuer: ISSUER,
      validFrom: "2024-06-14T00:00:00Z",
      purpose: "revocation" as const,
      list: listWith(),
    };
    const options = { clock: clockAt(NOW) };
    const bad = (extra: object) => JSON.parse(JSON.stringify(extra));
    await expect(
      issueStatusListCredential({ ...input, ...bad({ purpose: "message" }) }, signer, options),
    ).rejects.toBeInstanceOf(DataError);
    await expect(issueStatusListCredential({ ...input, ...bad({ id: "" }) }, signer, options)).rejects.toBeInstanceOf(
      DataError,
    );
    await expect(
      issueStatusListCredential({ ...input, ...bad({ validUntil: 5 }) }, signer, options),
    ).rejects.toBeInstanceOf(DataError);
    await expect(
      issueStatusListCredential({ ...input, ...bad({ ttlMilliseconds: 0 }) }, signer, options),
    ).rejects.toBeInstanceOf(DataError);
    await expect(
      issueStatusListCredential({ ...input, list: { length: 8, bits: new Uint8Array(1) } }, signer, options),
    ).rejects.toBeInstanceOf(DataError);
    await expect(issueStatusListCredential(JSON.parse("null"), signer, options)).rejects.toBeInstanceOf(DataError);
    await expect(issueStatusListCredential(input, signerOf(KEYS.es256), options)).rejects.toThrow("keyId");
    await expect(
      issueStatusListCredential(input, signer, { ...options, ...bad({ proof: "cose" }) }),
    ).rejects.toBeInstanceOf(DataError);
    await expect(issueStatusListCredential(input, signer, { ...options, proof: "data-integrity" })).rejects.toThrow(
      "contexts is required",
    );
    await expect(
      issueStatusListCredential(input, signer, { ...options, proof: "data-integrity", ...bad({ contexts: 5 }) }),
    ).rejects.toBeInstanceOf(DataError);
    await expect(issueStatusListCredential(input, signer, JSON.parse("null"))).rejects.toBeInstanceOf(DataError);
    await expect(
      issueStatusListCredential(input, signer, { ...options, ...bad({ signal: 1 }) }),
    ).rejects.toBeInstanceOf(DataError);
  });
});

describe("checking the status of a credential", () => {
  it("passes when the entry is clear, reading the list credential that its issuer signed", async () => {
    const { run, w } = status({}, { [LIST_URL]: await listJws(listWith(1)) });
    expect(await run()).toMatchObject({ check: "status", outcome: "passed" });
    expect(w.requests.filter((url) => url === LIST_URL)).toHaveLength(1);
  });

  it.each([
    ["revocation", "revoked"],
    ["suspension", "suspended"],
  ] as const)("fails when the entry is set, for %s: the credential is %s", async (purpose, meaning) => {
    const { run } = status({ statusPurpose: purpose }, { [LIST_URL]: await listJws(listWith(94_567), { purpose }) });
    expect(await run()).toMatchObject({ outcome: "failed", detail: expect.stringContaining(`is ${meaning}`) });
  });

  it("fails with a purpose mismatch when the list is for another purpose", async () => {
    const { run } = status(
      { statusPurpose: "suspension" },
      { [LIST_URL]: await listJws(listWith(), { purpose: "revocation" }) },
    );
    expect(await run()).toMatchObject({ outcome: "failed", detail: expect.stringContaining("purpose mismatch") });
  });

  it("fails with STATUS_LIST_LENGTH_ERROR for a list of fewer than 131,072 entries", async () => {
    // The issuer refuses such a list, so the credential is made by hand.
    const { signCredentialJwt } = await import("../src/jwt/index.js");
    const subject = {
      id: `${LIST_URL}#list`,
      type: "BitstringStatusList",
      statusPurpose: "revocation",
      encodedList: await encodeList({ length: 64, bits: new Uint8Array(8) }),
    };
    const small = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      id: LIST_URL,
      type: ["VerifiableCredential", "BitstringStatusListCredential"],
      issuer: ISSUER,
      validFrom: "2024-06-14T00:00:00Z",
      credentialSubject: subject,
    };
    const jws = await signCredentialJwt(small as never, signer, { kid: METHOD });
    const { run } = status({ statusListIndex: "3" }, { [LIST_URL]: jws });
    expect(await run()).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("STATUS_LIST_LENGTH_ERROR"),
    });
  });

  it("fails with RANGE_ERROR for an index outside the list, or one that is no integer", async () => {
    const { run } = status({ statusListIndex: "131072" }, { [LIST_URL]: await listJws(listWith()) });
    expect(await run()).toMatchObject({ outcome: "failed", detail: expect.stringContaining("RANGE_ERROR") });
    for (const index of ["-1", "1.5", "abc", 5, undefined]) {
      const { run: again } = status({ statusListIndex: index }, { [LIST_URL]: await listJws(listWith()) });
      expect(await again(), String(index)).toMatchObject({
        outcome: "failed",
        detail: expect.stringContaining("RANGE_ERROR"),
      });
    }
  });

  it("fails when the list credential is signed by a key its issuer does not publish", async () => {
    const { run } = status({}, { [LIST_URL]: await listJws(listWith(), {}, attacker) });
    expect(await run()).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("STATUS_VERIFICATION_ERROR"),
    });
  });

  it("fails when the list credential is issued by another issuer, unless the host allows that issuer", async () => {
    const other = "https://other.example/issuers/9";
    const credential = credentialWithStatus({}, other);
    const w = world({ [LIST_URL]: await listJws(listWith()) });
    expect(await verifyCredentialStatus(credential, w.options)).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining(`issued by ${ISSUER}, not by ${other}`),
    });
    expect(await verifyCredentialStatus(credential, { ...w.options, statusIssuers: [ISSUER] })).toMatchObject({
      outcome: "passed",
    });
  });

  it("fails when the list credential is not valid yet or has expired, within the skew", async () => {
    const early = status({}, { [LIST_URL]: await listJws(listWith(), { validFrom: "2024-06-15T00:00:00Z" }) });
    expect(await early.run()).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("not valid before"),
    });
    const late = status(
      {},
      {
        [LIST_URL]: await listJws(listWith(), {
          validFrom: "2024-06-01T00:00:00Z",
          validUntil: "2024-06-14T11:58:00Z",
        }),
      },
    );
    expect(await late.run()).toMatchObject({ outcome: "failed" });
    const inSkew = status(
      {},
      {
        [LIST_URL]: await listJws(listWith(), {
          validFrom: "2024-06-01T00:00:00Z",
          validUntil: "2024-06-14T12:00:30Z",
        }),
      },
    );
    expect(await inSkew.run()).toMatchObject({ outcome: "passed" });
  });

  it("judges the validity of a list credential under the Data Model 1.1 by its issuanceDate and expirationDate", async () => {
    const { signCompactJws } = await import("@interopkit/core");
    const listOf = async (expirationDate: string) => {
      const vc = {
        "@context": ["https://www.w3.org/2018/credentials/v1"],
        type: ["VerifiableCredential", "BitstringStatusListCredential"],
        issuer: { id: ISSUER, type: ["Profile"] },
        issuanceDate: "2024-06-01T00:00:00Z",
        expirationDate,
        credentialSubject: {
          id: `${LIST_URL}#list`,
          type: "BitstringStatusList",
          statusPurpose: "revocation",
          encodedList: await encodeList(listWith()),
        },
      };
      // The vc claim form of VC-JWT 1.1, with no time claim: the dates of the credential are its only period.
      const payload = new TextEncoder().encode(JSON.stringify({ iss: ISSUER, vc }));
      return await signCompactJws({ typ: "JWT" }, payload, signer);
    };
    expect(await status({}, { [LIST_URL]: await listOf("2024-06-14T11:00:00Z") }).run()).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("not valid at this time"),
    });
    expect(await status({}, { [LIST_URL]: await listOf("2024-06-15T00:00:00Z") }).run()).toMatchObject({
      outcome: "passed",
    });
  });

  it("fails for a credential that is no status list credential", async () => {
    const { signCredentialJwt } = await import("../src/jwt/index.js");
    const plain = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiableCredential"],
      issuer: ISSUER,
      validFrom: "2024-06-14T00:00:00Z",
      credentialSubject: { id: "did:example:learner" },
    };
    const jws = await signCredentialJwt(plain as never, signer, { kid: METHOD });
    expect(await status({}, { [LIST_URL]: jws }).run()).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("BitstringStatusListCredential"),
    });
  });

  it("is unavailable when the list cannot be fetched, and the abort of the caller passes", async () => {
    expect(await status({}, { [LIST_URL]: 503 }).run()).toMatchObject({
      outcome: "unavailable",
      detail: expect.stringContaining("STATUS_RETRIEVAL_ERROR"),
    });
    expect(await status({}, {}).run()).toMatchObject({ outcome: "unavailable" });
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      status({}, { [LIST_URL]: await listJws(listWith()) }).run({ signal: controller.signal }),
    ).rejects.toThrow("stop");
  });

  it("is skipped, never guessed, for what it does not read as one bit", async () => {
    const w = world({ [LIST_URL]: await listJws(listWith(94_567)) });
    const skipped = async (credential: unknown) => verifyCredentialStatus(credential as never, w.options);
    const bare = { ...credentialWithStatus() } as unknown as Record<string, unknown>;
    const { credentialStatus: _gone, ...noStatus } = bare;
    expect(await skipped(noStatus)).toMatchObject({
      outcome: "skipped",
      detail: "The credential has no credentialStatus.",
    });
    expect(await skipped(credentialWithStatus({ type: "StatusList2021Entry" }))).toMatchObject({
      outcome: "skipped",
      detail: expect.stringContaining("BitstringStatusListEntry and 1EdTechRevocationList are checked"),
    });
    expect(await skipped({ ...bare, credentialStatus: "a text" })).toMatchObject({ outcome: "skipped" });
    expect(
      await skipped(
        credentialWithStatus({ statusPurpose: "message", statusMessage: [{ status: "0x0", message: "a" }] }),
      ),
    ).toMatchObject({ outcome: "skipped", detail: expect.stringContaining("not revocation or suspension") });
    expect(await skipped(credentialWithStatus({ statusSize: 2 }))).toMatchObject({
      outcome: "skipped",
      detail: expect.stringContaining("statusSize"),
    });
    expect(w.requests.filter((url) => url === LIST_URL)).toHaveLength(0);
  });

  it("fails for a list address that is not HTTPS", async () => {
    const { run } = status({ statusListCredential: "http://example.edu/list" });
    expect(await run()).toMatchObject({ outcome: "failed", detail: expect.stringContaining("not an HTTPS address") });
  });

  it("stops a gzip bomb within the fetch limit at 16,777,216 bytes", async () => {
    const { signCredentialJwt } = await import("../src/jwt/index.js");
    const zeros = new Uint8Array(20 * 1024 * 1024);
    const stream = new Blob([zeros]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(compressed.byteLength).toBeLessThan(100_000);
    const { base64url } = await import("jose");
    const bomb = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      id: LIST_URL,
      type: ["VerifiableCredential", "BitstringStatusListCredential"],
      issuer: ISSUER,
      validFrom: "2024-06-14T00:00:00Z",
      credentialSubject: {
        id: `${LIST_URL}#list`,
        type: "BitstringStatusList",
        statusPurpose: "revocation",
        encodedList: `u${base64url.encode(compressed)}`,
      },
    };
    const jws = await signCredentialJwt(bomb as never, signer, { kid: METHOD });
    const started = performance.now();
    expect(await status({}, { [LIST_URL]: jws }).run()).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("inflates to more than the 16777216 bytes"),
    });
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("reads a status list credential with a Data Integrity proof, and fails one that was changed or has no proof", async () => {
    const edKey = KEYS.ed25519;
    const did = `did:key:${edKey.multikey}`;
    const contexts = memoryContexts();
    const issued = (await issueStatusListCredential(
      { id: LIST_URL, issuer: did, validFrom: "2024-06-14T00:00:00Z", purpose: "revocation", list: listWith(7) },
      signerOf(edKey, `${did}#${edKey.multikey}`),
      { proof: "data-integrity", contexts: contexts.load, clock: clockAt(NOW) },
    )) as unknown as Record<string, unknown>;
    const credential = credentialWithStatus({ statusListIndex: "7" }, did);
    const w = world({ [LIST_URL]: issued });
    const options = { ...w.options, contexts: contexts.load };
    expect(await verifyCredentialStatus(credential, options)).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("is revoked"),
    });
    const clear = credentialWithStatus({ statusListIndex: "8" }, did);
    expect(await verifyCredentialStatus(clear, options)).toMatchObject({ outcome: "passed" });
    expect(await verifyCredentialStatus(clear, w.options)).toMatchObject({
      outcome: "unavailable",
      detail: expect.stringContaining("no loader of contexts"),
    });
    const tampered = world({ [LIST_URL]: { ...issued, validUntil: "2099-01-01T00:00:00Z" } });
    expect(await verifyCredentialStatus(clear, { ...tampered.options, contexts: contexts.load })).toMatchObject({
      outcome: "failed",
    });
    const { proof: _proof, ...unsigned } = issued;
    const bare = world({ [LIST_URL]: unsigned });
    expect(await verifyCredentialStatus(clear, { ...bare.options, contexts: contexts.load })).toMatchObject({
      outcome: "failed",
    });
    const broken = world({ [LIST_URL]: "{ not json" });
    expect(await verifyCredentialStatus(clear, { ...broken.options, contexts: contexts.load })).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("not JSON"),
    });
    const deep = world({ [LIST_URL]: `{"a":${"[".repeat(100)}${"]".repeat(100)}}` });
    expect(await verifyCredentialStatus(clear, { ...deep.options, contexts: contexts.load })).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("nests more than"),
    });
    const invalid = world({ [LIST_URL]: { type: ["VerifiableCredential"] } });
    expect(await verifyCredentialStatus(clear, { ...invalid.options, contexts: contexts.load })).toMatchObject({
      outcome: "failed",
    });
  });

  it("fails a list credential with more tokens of JSON than maxTokens before it parses it, as JSON or as a JWS", async () => {
    const w = world({ [LIST_URL]: `{"a":${HOSTILE}}` });
    const hostile = await neverParsesLarge(() =>
      verifyCredentialStatus(credentialWithStatus(), { ...w.options, maxBytes: 2_000_000 }),
    );
    expect(hostile).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("more than the 1000000 tokens"),
    });
    const signed = status({}, { [LIST_URL]: await listJws(listWith()) });
    expect(await signed.run({ maxTokens: 20 })).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("more than the 20 tokens"),
    });
    expect(await signed.run()).toMatchObject({ outcome: "passed" });
  });

  it("fails a list credential that nests deeper than the limit before it parses it", async () => {
    const deep = `{"a":${"[".repeat(150_000)}${"]".repeat(150_000)}}`;
    const w = world({ [LIST_URL]: deep });
    const result = await neverParsesLarge(() => verifyCredentialStatus(credentialWithStatus(), w.options));
    expect(result).toMatchObject({ outcome: "failed", detail: expect.stringContaining("nests more than 64 levels") });
  });

  it("fails a Data Integrity status list credential that is not valid at this time", async () => {
    const edKey = KEYS.ed25519;
    const did = `did:key:${edKey.multikey}`;
    const contexts = memoryContexts();
    const issue = async (dates: { validFrom: string; validUntil?: string }) =>
      (await issueStatusListCredential(
        { id: LIST_URL, issuer: did, purpose: "revocation", list: listWith(), ...dates },
        signerOf(edKey, `${did}#${edKey.multikey}`),
        { proof: "data-integrity", contexts: contexts.load, clock: clockAt(NOW) },
      )) as unknown as Record<string, unknown>;
    const credential = credentialWithStatus({ statusListIndex: "8" }, did);
    for (const dates of [
      { validFrom: "2024-06-15T00:00:00Z" },
      { validFrom: "2024-06-01T00:00:00Z", validUntil: "2024-06-14T11:00:00Z" },
    ]) {
      const w = world({ [LIST_URL]: await issue(dates) });
      expect(await verifyCredentialStatus(credential, { ...w.options, contexts: contexts.load })).toMatchObject({
        outcome: "failed",
        detail: expect.stringContaining("not valid at this time"),
      });
    }
  });

  it("judges the validity of a list within clockSkewSeconds", async () => {
    const edKey = KEYS.ed25519;
    const did = `did:key:${edKey.multikey}`;
    const contexts = memoryContexts();
    const list = await issueStatusListCredential(
      { id: LIST_URL, issuer: did, purpose: "revocation", list: listWith(), validFrom: "2024-06-14T12:00:30Z" },
      signerOf(edKey, `${did}#${edKey.multikey}`),
      { proof: "data-integrity", contexts: contexts.load, clock: clockAt(NOW) },
    );
    const credential = credentialWithStatus({ statusListIndex: "8" }, did);
    const w = world({ [LIST_URL]: list });
    const options = { ...w.options, contexts: contexts.load };
    expect((await verifyCredentialStatus(credential, options)).outcome).toBe("passed");
    expect((await verifyCredentialStatus(credential, { ...options, clockSkewSeconds: 0 })).outcome).toBe("failed");
  });

  it("inflates a list once for every credential that names it", async () => {
    const w = world({ [LIST_URL]: await listJws(listWith()) });
    const cache = createStatusListCache({ clock: clockAt(NOW) });
    let inflated = 0;
    const Original = globalThis.DecompressionStream;
    vi.stubGlobal(
      "DecompressionStream",
      class extends Original {
        constructor(format: CompressionFormat) {
          super(format);
          inflated += 1;
        }
      },
    );
    try {
      for (const index of ["8", "9", "10"]) {
        await verifyCredentialStatus(credentialWithStatus({ statusListIndex: index }), { ...w.options, cache });
      }
    } finally {
      vi.unstubAllGlobals();
    }
    expect(inflated).toBe(1);
  });

  it("passes on the failure of a cache that is no fault of the list", async () => {
    const w = world({ [LIST_URL]: await listJws(listWith()) });
    const cache = { get: async () => Promise.reject(new TypeError("the cache broke")) };
    await expect(verifyCredentialStatus(credentialWithStatus(), { ...w.options, cache })).rejects.toThrow(
      "the cache broke",
    );
  });

  it("refuses options and a credential of the wrong type", async () => {
    const w = world();
    const credential = credentialWithStatus();
    const bad = (extra: object) => ({ ...w.options, ...JSON.parse(JSON.stringify(extra)) });
    await expect(verifyCredentialStatus(JSON.parse("null"), w.options)).rejects.toBeInstanceOf(DataError);
    await expect(verifyCredentialStatus(credential, JSON.parse("null"))).rejects.toBeInstanceOf(DataError);
    for (const extra of [
      { fetch: 5 },
      { keys: {} },
      { contexts: 5 },
      { cache: 5 },
      { cache: {} },
      { statusIssuers: "x" },
      { statusIssuers: [5] },
      { timeoutMs: 0 },
      { maxBytes: 1.5 },
      { maxTokens: 0 },
      { algorithms: "ES256" },
      { algorithms: [5] },
      { clockSkewSeconds: -1 },
      { allowUnboundKeys: "yes" },
      { legacyProofs: 1 },
      { suites: "x" },
      { suites: [{ cryptosuite: "x" }] },
      { signal: 1 },
      { clock: 5 },
    ]) {
      await expect(verifyCredentialStatus(credential, bad(extra)), JSON.stringify(extra)).rejects.toBeInstanceOf(
        DataError,
      );
    }
  });
});

describe("the cache of status list credentials", () => {
  async function fixture(extra: { ttlMilliseconds?: number; validUntil?: string } = {}) {
    const w = world({ [LIST_URL]: await listJws(listWith(), { validFrom: "2024-06-01T00:00:00Z", ...extra }) });
    const cache = createStatusListCache({ clock: w.clock });
    const run = () => verifyCredentialStatus(credentialWithStatus(), { ...w.options, cache });
    const listRequests = () => w.requests.filter((url) => url === LIST_URL).length;
    return { w, run, listRequests };
  }

  it("keeps a list for 300,000 ms when it gives no ttl, and fetches it again after", async () => {
    const { w, run, listRequests } = await fixture();
    await run();
    w.clock.advance(299_999);
    await run();
    expect(listRequests()).toBe(1);
    w.clock.advance(1);
    expect(await run()).toMatchObject({ outcome: "passed" });
    expect(listRequests()).toBe(2);
  });

  it("keeps a list for its ttl, or until its validUntil, whichever comes first", async () => {
    const ttl = await fixture({ ttlMilliseconds: 10_000 });
    await ttl.run();
    ttl.w.clock.advance(10_000);
    await ttl.run();
    expect(ttl.listRequests()).toBe(2);
    const until = await fixture({ ttlMilliseconds: 600_000, validUntil: "2024-06-14T12:01:00Z" });
    await until.run();
    until.w.clock.advance(59_000);
    await until.run();
    expect(until.listRequests()).toBe(1);
    until.w.clock.advance(1_000);
    await until.run();
    expect(until.listRequests()).toBe(2);
  });

  it("shares one fetch between verifications that run together, and does not keep a failure", async () => {
    const { run, listRequests } = await fixture();
    await Promise.all([run(), run(), run()]);
    expect(listRequests()).toBe(1);
    const w = world({ [LIST_URL]: 503 });
    const cache = createStatusListCache({ clock: w.clock });
    const check = () => verifyCredentialStatus(credentialWithStatus(), { ...w.options, cache });
    expect(await check()).toMatchObject({ outcome: "unavailable" });
    expect(await check()).toMatchObject({ outcome: "unavailable" });
    expect(w.requests.filter((url) => url === LIST_URL)).toHaveLength(2);
  });

  it("never serves a list to a call that trusts less than the call that verified it", async () => {
    const did = `did:key:${KEYS.other.multikey}`;
    const forged = await listJws(listWith(), {}, signerOf(KEYS.other, `${did}#${KEYS.other.multikey}`));
    const w = world({ [LIST_URL]: forged });
    const cache = createStatusListCache({ clock: w.clock });
    const check = (options: object = {}) =>
      verifyCredentialStatus(credentialWithStatus(), { ...w.options, cache, ...options });
    const refused = { outcome: "failed", detail: expect.stringContaining("STATUS_VERIFICATION_ERROR") };
    expect(await check({ allowUnboundKeys: true })).toMatchObject({ outcome: "passed" });
    expect(await check()).toMatchObject(refused);
    // A resolver that says that the issuer publishes the forger's key is a policy of its own.
    const forgerKey = { id: `${did}#${KEYS.other.multikey}`, publicKeyJwk: KEYS.other.publicJwk };
    const lax = {
      resolve: async () => ({ ...forgerKey, relationships: [] }),
      issuerKeys: async () => [{ ...forgerKey, relationships: ["assertionMethod" as const] }],
    };
    expect(await check({ keys: lax })).toMatchObject({ outcome: "passed" });
    expect(await check()).toMatchObject(refused);
    expect(await check({ allowUnboundKeys: true })).toMatchObject({ outcome: "passed" });
    // Each policy fetched the list once, and a list that a call refused is not kept: the strict calls fetched it twice.
    expect(w.requests.filter((url) => url === LIST_URL)).toHaveLength(4);
  });

  it("verifies a list that calls share with no caller's signal, so that one caller's abort ends only its own wait", async () => {
    const w = world({ [LIST_URL]: await listJws(listWith()) });
    const cache = createStatusListCache({ clock: w.clock });
    let open = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const asked: (AbortSignal | undefined)[] = [];
    const keys = {
      resolve: async (method: string, options?: { readonly signal?: AbortSignal }) => {
        asked.push(options?.signal);
        await gate;
        return await w.keys.resolve(method);
      },
      issuerKeys: w.keys.issuerKeys,
    };
    const first = new AbortController();
    const check = (signal?: AbortSignal) =>
      verifyCredentialStatus(credentialWithStatus(), {
        ...w.options,
        keys,
        cache,
        ...(signal === undefined ? {} : { signal }),
      });
    const aborted = check(first.signal);
    const other = check();
    const gaveUp = expect(aborted).rejects.toThrow("the first caller stopped");
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    first.abort(new Error("the first caller stopped"));
    await gaveUp;
    open();
    expect(await other).toMatchObject({ outcome: "passed" });
    expect(asked).toStrictEqual([undefined]);
    expect(w.requests.filter((url) => url === LIST_URL)).toHaveLength(1);
  });

  it("ends the wait for a cache of the host when the signal aborts, whatever the cache does", async () => {
    const w = world({ [LIST_URL]: await listJws(listWith()) });
    const { hang, seen } = hangingPort();
    await abortsWhileWaiting(
      (signal) => verifyCredentialStatus(credentialWithStatus(), { ...w.options, cache: { get: hang }, signal }),
      seen,
    );
  });

  it("holds at most the entries it is given, and is refused options of the wrong type", () => {
    const clock = clockAt(NOW);
    expect(() => createStatusListCache({ clock, maxEntries: 0 })).toThrow(DataError);
    expect(() => createStatusListCache(JSON.parse("null"))).toThrow(DataError);
    expect(() => createStatusListCache(JSON.parse("{}"))).toThrow(DataError);
    expect(createStatusListCache({ clock }).get).toBeTypeOf("function");
  });
});

describe("a revocation list of the 1EdTech Revocation List Status Method", () => {
  const REVOCATIONS = "https://example.edu/revocations/24";
  /** A credential that names the revocation list, as credentials of Open Badges 3.0 did before Bitstring Status List. */
  const named = (extra: Record<string, unknown> = {}) =>
    ({
      ...credentialWithStatus(),
      credentialStatus: { id: REVOCATIONS, type: "1EdTechRevocationList" },
      ...extra,
    }) as unknown as Parameters<typeof verifyCredentialStatus>[0];
  const ID = "https://example.edu/credentials/1";
  const listOf = (revoked: unknown[], extra: Record<string, unknown> = {}) => ({
    id: REVOCATIONS,
    issuer: ISSUER,
    revokedCredential: revoked,
    ...extra,
  });
  const check = async (list: unknown, credential = named(), options: object = {}) => {
    const w = world({ [REVOCATIONS]: list });
    return await verifyCredentialStatus(credential, { ...w.options, ...options });
  };

  it("fails a credential that the list names as revoked, with the reason, whether revoked is true, absent or the text true", async () => {
    for (const entry of [{ id: ID }, { id: ID, revoked: true }, { id: ID, revoked: "true" }]) {
      expect(await check(listOf([{ ...entry, revocationReason: "No final payment" }]))).toMatchObject({
        outcome: "failed",
        detail: "The credential is revoked: No final payment",
      });
    }
  });

  it("passes a credential that the list does not name, or names as reinstated", async () => {
    expect((await check(listOf([{ id: "https://example.edu/credentials/2" }]))).outcome).toBe("passed");
    expect((await check(listOf([{ id: ID, revoked: false }]))).outcome).toBe("passed");
    expect((await check(listOf([]))).outcome).toBe("passed");
  });

  it("reads the revoked credentials under the name of the data model and under that of the protocol", async () => {
    const protocol = { id: REVOCATIONS, issuer: ISSUER, revokedCredentials: [{ id: ID }] };
    expect((await check(protocol)).outcome).toBe("failed");
  });

  it("fails a list that names another issuer, unless statusIssuers allows it", async () => {
    const other = listOf([{ id: ID }], { issuer: "https://other.example/issuers/1" });
    expect(await check(other)).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("STATUS_VERIFICATION_ERROR"),
    });
    const allowed = await check(other, named(), { statusIssuers: ["https://other.example/issuers/1"] });
    expect(allowed.outcome).toBe("failed");
    expect(allowed.detail).toContain("revoked");
    expect((await check(listOf([], { issuer: [ISSUER, "https://other.example/issuers/1"] }))).outcome).toBe("passed");
  });

  it("is unavailable when the list cannot be fetched, failed when it is not a JSON object or not at an HTTPS address", async () => {
    expect((await check(503)).outcome).toBe("unavailable");
    expect((await check("not json")).outcome).toBe("failed");
    expect((await check("[1]")).outcome).toBe("failed");
    const insecure = named({
      credentialStatus: { id: "http://example.edu/revocations/24", type: "1EdTechRevocationList" },
    });
    expect(await check(listOf([]), insecure)).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("HTTPS"),
    });
  });

  it("is skipped for a credential with no id, which no list can name", async () => {
    const { id: _id, ...anonymous } = named() as unknown as Record<string, unknown>;
    expect((await check(listOf([{ id: ID }]), anonymous as never)).outcome).toBe("skipped");
  });

  it("is fetched once across verifications with a cache", async () => {
    const w = world({ [REVOCATIONS]: listOf([]) });
    const cache = createStatusListCache({ clock: clockAt(NOW) });
    for (let time = 0; time < 3; time += 1) await verifyCredentialStatus(named(), { ...w.options, cache });
    expect(w.requests.filter((url) => url === REVOCATIONS)).toHaveLength(1);
  });
});
