import jsonld from "@interop/jsonld";
import { DataError, LimitError } from "@interopkit/core";
import { describe, expect, it, vi } from "vitest";
import { addProof, deriveDisclosure, validateJsonLd, verifyProof } from "../src/data-integrity/index.js";
import { boundedCanonize, EDDSA_RDFC_2022 } from "../src/data-integrity/internal.js";
import type { DataIntegritySuite, IssuableCredential, KeyResolver } from "../src/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { memoryContexts } from "./context-fixtures.js";
import { achievementCredential } from "./fixtures.js";
import { clockAt, KEYS, signerOf, type TestKey } from "./key-fixtures.js";

const NOW = Date.UTC(2024, 5, 14, 12, 0, 0);

/** An issuer that is the did:key of a key, which publishes itself. */
function issuerOf(key: TestKey) {
  const did = `did:key:${key.multikey}`;
  const method = `${did}#${key.multikey}`;
  return { did, method, signer: signerOf(key, method) };
}

const eddsa = issuerOf(KEYS.ed25519);
const sd = issuerOf(KEYS.es256);

/** A credential of an issuer, with any other properties. */
const credentialOf = (did: string, extra: Record<string, unknown> = {}) =>
  ({ ...achievementCredential(), issuer: { id: did, type: ["Profile"] }, ...extra }) as unknown as IssuableCredential;

/** As many properties as asked, each with its own name: their cost grows with their number and not with its square. */
const manyProperties = (count: number) =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}`, "x"]));

function world() {
  const clock = clockAt(NOW);
  const contexts = memoryContexts();
  const keys = createKeyResolver({ clock });
  return {
    clock,
    contexts,
    keys,
    sign: { clock, contexts: contexts.load },
    read: { keys, clock, contexts: contexts.load },
  };
}

/** The proofs of a credential, as a list. */
const proofsOf = (credential: unknown) => (credential as { proof: Record<string, unknown>[] }).proof;

/** The reason of a result that is not valid. */
const reasonOf = (result: { valid: boolean; reason?: string }) => result.reason ?? "";

describe("the tokens that a processor of JSON-LD reads", () => {
  it("are limited by maxJsonLdTokens when verifying, before a key is read or a context is loaded", async () => {
    const { sign, keys, contexts } = world();
    const signed = await addProof(credentialOf(eddsa.did), eddsa.signer, sign);
    const resolved: string[] = [];
    const watching: KeyResolver = {
      resolve: (method, options) => {
        resolved.push(method);
        return keys.resolve(method, options);
      },
      issuerKeys: (issuer, options) => keys.issuerKeys(issuer, options),
    };
    contexts.requested.length = 0;
    const result = await verifyProof(signed, {
      keys: watching,
      clock: clockAtNow(),
      contexts: contexts.load,
      maxJsonLdTokens: 50,
    });
    expect(result.valid).toBe(false);
    expect(reasonOf(result)).toContain("maxJsonLdTokens");
    expect(resolved).toStrictEqual([]);
    expect(contexts.requested).toStrictEqual([]);
  });

  it("are 20,000 by default: a larger credential is not signed, and the proof of one is not checked", async () => {
    const { sign, read } = world();
    const signed = await addProof(credentialOf(eddsa.did), eddsa.signer, sign);
    const extra = manyProperties(6000);
    await expect(addProof(credentialOf(eddsa.did, { extra }), eddsa.signer, sign)).rejects.toThrow(
      /more than the 20000 tokens/u,
    );
    expect(reasonOf(await verifyProof({ ...signed, extra } as unknown as IssuableCredential, read))).toContain(
      "more than the 20000 tokens",
    );
  });

  it("are raised by a host, for signing and for verifying alike", async () => {
    const { sign, read } = world();
    const credential = credentialOf(eddsa.did, { extra: manyProperties(300) });
    await expect(addProof(credential, eddsa.signer, { ...sign, maxJsonLdTokens: 1000 })).rejects.toThrow(
      /maxJsonLdTokens/u,
    );
    const signed = await addProof(credential, eddsa.signer, { ...sign, maxJsonLdTokens: 2000 });
    expect(reasonOf(await verifyProof(signed, { ...read, maxJsonLdTokens: 1000 }))).toContain("maxJsonLdTokens");
    expect((await verifyProof(signed, { ...read, maxJsonLdTokens: 2000 })).valid).toBe(true);
  });

  it("are not counted in a credential that has no proof, which is told as it is", async () => {
    const { read } = world();
    const big = credentialOf(eddsa.did, { extra: manyProperties(6000) });
    expect(await verifyProof(big, read)).toStrictEqual({ valid: false, reason: "The credential has no proof." });
  });

  it("are limited when signing, deriving and validating, before any context is loaded", async () => {
    const { sign, contexts, clock } = world();
    const big = credentialOf(sd.did, { extra: manyProperties(6000) });
    await expect(addProof(big, sd.signer, { ...sign, cryptosuite: "ecdsa-sd-2023" })).rejects.toThrow(
      /maxJsonLdTokens/u,
    );
    await expect(validateJsonLd(big, { contexts: contexts.load })).rejects.toThrow(/maxJsonLdTokens/u);
    expect(await validateJsonLd(big, { contexts: contexts.load, maxJsonLdTokens: 100_000 })).toBeDefined();
    const base = await addProof(credentialOf(sd.did), sd.signer, { ...sign, cryptosuite: "ecdsa-sd-2023" });
    await expect(
      deriveDisclosure(base, { selectivePointers: [], contexts: contexts.load, maxJsonLdTokens: 50 }),
    ).rejects.toThrow(/maxJsonLdTokens/u);
    void clock;
  });

  it("are read with the levels of the credential, so that deriving and validating refuse a deep one before they copy it", async () => {
    const { contexts } = world();
    let deep: Record<string, unknown> = { name: "x" };
    for (let level = 0; level < 4_000; level += 1) deep = { nested: deep };
    const credential = credentialOf(sd.did, { extra: deep });
    await expect(validateJsonLd(credential, { contexts: contexts.load })).rejects.toThrow(
      new LimitError("The credential nests more than 64 levels of JSON.", "maxDepth", 64),
    );
    await expect(deriveDisclosure(credential, { selectivePointers: [], contexts: contexts.load })).rejects.toThrow(
      new LimitError("The credential nests more than 64 levels of JSON.", "maxDepth", 64),
    );
    // Over both limits, the credential is refused for its tokens, which name the option that a host can raise, though its
    // brackets pass the levels at the 200th token and its tokens pass 5,000 later.
    await expect(validateJsonLd(credential, { contexts: contexts.load, maxJsonLdTokens: 5_000 })).rejects.toMatchObject(
      {
        name: "LimitError",
        limit: "maxJsonLdTokens",
        maximum: 5_000,
      },
    );
  });

  it("are not counted in a value that is not JSON, which validateJsonLd is refused as such", async () => {
    const { contexts } = world();
    const cyclic: Record<string, unknown> = { ...achievementCredential() };
    cyclic.self = cyclic;
    await expect(validateJsonLd(cyclic as unknown as IssuableCredential, { contexts: contexts.load })).rejects.toThrow(
      /not JSON/u,
    );
  });

  it("are refused by every function as an option of the wrong type or value", async () => {
    const { sign, read, contexts } = world();
    const credential = credentialOf(eddsa.did);
    const base = await addProof(credentialOf(sd.did), sd.signer, { ...sign, cryptosuite: "ecdsa-sd-2023" });
    for (const value of [0, -1, 1.5, "20000", null]) {
      const bad = { maxJsonLdTokens: JSON.parse(JSON.stringify(value)) };
      await expect(addProof(credential, eddsa.signer, { ...sign, ...bad })).rejects.toThrow(DataError);
      await expect(verifyProof(credential, { ...read, ...bad })).rejects.toThrow(DataError);
      await expect(validateJsonLd(credential, { contexts: contexts.load, ...bad })).rejects.toThrow(DataError);
      await expect(deriveDisclosure(base, { selectivePointers: [], contexts: contexts.load, ...bad })).rejects.toThrow(
        DataError,
      );
    }
  });
});

describe("the canonical form of a document", () => {
  const document = () => ({
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential"],
    name: "x",
  });

  it("is not kept when the canonicalization fails, so that the next try is made", async () => {
    const { contexts } = world();
    let down = true;
    const documentLoader = async (url: string) => {
      if (down) throw new Error("The context is down.");
      return { contextUrl: null, documentUrl: url, document: await contexts.load(url) };
    };
    const input = document();
    await expect(boundedCanonize(input, { documentLoader })).rejects.toThrow();
    down = false;
    expect(await boundedCanonize(input, { documentLoader })).toContain("VerifiableCredential");
  });

  it("is computed once for the same document under one digest, and again under another digest", async () => {
    const { contexts } = world();
    const documentLoader = async (url: string) => ({
      contextUrl: null,
      documentUrl: url,
      document: await contexts.load(url),
    });
    const input = document();
    const canonize = vi.spyOn(jsonld, "canonize");
    try {
      const first = await boundedCanonize(input, { documentLoader });
      expect(await boundedCanonize(input, { documentLoader })).toBe(first);
      expect(canonize).toHaveBeenCalledTimes(1);
      await boundedCanonize(input, { documentLoader, messageDigestAlgorithm: "sha384" });
      expect(canonize).toHaveBeenCalledTimes(2);
      await boundedCanonize(document(), { documentLoader });
      expect(canonize).toHaveBeenCalledTimes(3);
    } finally {
      canonize.mockRestore();
    }
  });
});

describe("the proofs of one credential", () => {
  /** A credential of the issuer whose proofs are the given number of copies of its proof with another value. */
  async function withProofs(count: number, validAt?: number) {
    const { sign, read } = world();
    const signed = await addProof(credentialOf(eddsa.did), eddsa.signer, sign);
    const [honest] = proofsOf(signed);
    const proofs = Array.from({ length: count }, (_, index) =>
      index === validAt ? honest : { ...honest, proofValue: `z${"1".repeat(40 + index)}` },
    );
    return { credential: { ...signed, proof: proofs } as unknown as IssuableCredential, read, keys: read.keys };
  }

  it("are checked up to four, in order, and no key is read for the rest", async () => {
    const { credential, read, keys } = await withProofs(6);
    const resolved: string[] = [];
    const watching: KeyResolver = {
      resolve: (method, options) => {
        resolved.push(method);
        return keys.resolve(method, options);
      },
      issuerKeys: (issuer, options) => keys.issuerKeys(issuer, options),
    };
    const result = await verifyProof(credential, { ...read, keys: watching });
    expect(result.valid).toBe(false);
    expect(reasonOf(result)).toMatch(/Only the first 4 of its 6 proofs are checked\.$/u);
    expect(resolved).toHaveLength(4);
  });

  it("are accepted when one of the first four is valid, and a valid fifth is not looked at", async () => {
    const accepted = await withProofs(5, 3);
    expect((await verifyProof(accepted.credential, accepted.read)).valid).toBe(true);
    const ignored = await withProofs(5, 4);
    expect((await verifyProof(ignored.credential, ignored.read)).valid).toBe(false);
  });

  it("are not told of when there are no more than four", async () => {
    const { credential, read } = await withProofs(4);
    expect(reasonOf(await verifyProof(credential, read))).not.toContain("Only the first");
  });

  it("canonize the credential once, whatever their number", async () => {
    const { credential, read } = await withProofs(4);
    const canonize = vi.spyOn(jsonld, "canonize");
    try {
      await verifyProof(credential, read);
      const ofCredential = canonize.mock.calls.filter(([input]) => Reflect.has(Object(input), "credentialSubject"));
      expect(ofCredential).toHaveLength(1);
      expect(canonize.mock.calls.length).toBe(5);
    } finally {
      canonize.mockRestore();
    }
  });
});

describe("a suite of the library", () => {
  it("checks the proof over the document as given, so a document that carries proofs is secured with them", async () => {
    const { sign, contexts } = world();
    const signed = await addProof(credentialOf(eddsa.did), eddsa.signer, sign);
    const [proof] = proofsOf(signed);
    const options = { publicKeyJwk: KEYS.ed25519.publicJwk, contexts: contexts.load };
    const { proof: _proof, ...unsecured } = signed as unknown as Record<string, unknown>;
    expect(await EDDSA_RDFC_2022.verify(unsecured, proof as never, options)).toBe(true);
    expect(await EDDSA_RDFC_2022.verify({ ...unsecured, name: "Changed" }, proof as never, options)).toBe(false);
    // The proofs that a document carries are what a proof of a chain signs with it, which this proof did not.
    expect(await EDDSA_RDFC_2022.verify(signed as never, proof as never, options)).toBe(false);
  });
});

describe("the suites that a host passes", () => {
  /** A suite that records what it is given, and answers as asked. */
  function recording(answer: () => Promise<boolean>) {
    const seen: { document: Readonly<Record<string, unknown>>; options: Record<string, unknown> }[] = [];
    const suite: DataIntegritySuite = {
      cryptosuite: "eddsa-jcs-2022",
      verify: async (document, _proof, options) => {
        seen.push({ document, options: { ...options } });
        return answer();
      },
    };
    return { suite, seen };
  }

  async function foreign(): Promise<{ credential: IssuableCredential; read: ReturnType<typeof world>["read"] }> {
    const { sign, read } = world();
    const signed = await addProof(credentialOf(eddsa.did), eddsa.signer, sign);
    const [proof] = proofsOf(signed);
    return {
      credential: { ...signed, proof: [{ ...proof, cryptosuite: "eddsa-jcs-2022" }] } as unknown as IssuableCredential,
      read,
    };
  }

  it("are given the credential without its proof, and the limits that the glue has checked", async () => {
    const { credential, read } = await foreign();
    const { suite, seen } = recording(async () => true);
    const result = await verifyProof(credential, {
      ...read,
      suites: [suite],
      maxInputBytes: 5000,
      maxJsonLdTokens: 4000,
    });
    expect(result.valid).toBe(true);
    expect(seen).toHaveLength(1);
    expect("proof" in (seen[0]?.document ?? {})).toBe(false);
    expect(seen[0]?.options).toMatchObject({ maxBytes: 5000, maxTokens: 4000 });
    expect(seen[0]?.options.publicKeyJwk).toBeDefined();
  });

  it("give the message of a DataError as the reason of the proof, which is not unavailable", async () => {
    const { credential, read } = await foreign();
    const { suite } = recording(async () => {
      throw new DataError("The document has more blank nodes than this suite takes.");
    });
    expect(await verifyProof(credential, { ...read, suites: [suite] })).toStrictEqual({
      valid: false,
      reason: "The document has more blank nodes than this suite takes.",
    });
  });

  it("pass on any other error, which is a fault of the host's and no verdict on the credential", async () => {
    const { credential, read } = await foreign();
    const { suite } = recording(async () => {
      throw new TypeError("a bug of the suite");
    });
    await expect(verifyProof(credential, { ...read, suites: [suite] })).rejects.toThrow(TypeError);
  });
});

describe("a proof added to a credential", () => {
  it("joins the proofs that an eddsa-rdfc-2022 credential has, as a set", async () => {
    const { sign } = world();
    const once = await addProof(credentialOf(eddsa.did), eddsa.signer, sign);
    const twice = await addProof(once, eddsa.signer, sign);
    expect(proofsOf(twice)).toHaveLength(2);
    expect(proofsOf(once)).toHaveLength(1);
  });

  it("is refused for a base proof of ecdsa-sd-2023 when the credential has a proof already, as the TSDoc says", async () => {
    const { sign } = world();
    const once = await addProof(credentialOf(sd.did), eddsa.signer, sign);
    await expect(addProof(once, sd.signer, { ...sign, cryptosuite: "ecdsa-sd-2023" })).rejects.toThrow(
      /already has a proof/u,
    );
    const base = await addProof(credentialOf(sd.did), sd.signer, { ...sign, cryptosuite: "ecdsa-sd-2023" });
    await expect(addProof(base, sd.signer, { ...sign, cryptosuite: "ecdsa-sd-2023" })).rejects.toThrow(DataError);
  });
});

function clockAtNow() {
  return clockAt(NOW);
}
