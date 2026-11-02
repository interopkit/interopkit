import jsonld from "@interop/jsonld";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addProof, deriveDisclosure, validateJsonLd, verifyProof } from "../src/data-integrity/index.js";
import { BUILT_IN_SUITES, ED25519_SIGNATURE_2020 } from "../src/data-integrity/internal.js";
import type { IssuableCredential } from "../src/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { memoryContexts } from "./context-fixtures.js";
import { achievementCredential } from "./fixtures.js";
import { clockAt, KEYS, signerOf } from "./key-fixtures.js";

const NOW = Date.UTC(2024, 5, 14);

/** What a processor of JSON-LD would do if it ran without the loader of the package: reach for the network. */
const FORBIDDEN = (): never => {
  throw new Error("A processor of JSON-LD ran without the loader of the package.");
};

let defaultLoader: unknown;
let defaultFetch: unknown;

beforeAll(() => {
  defaultLoader = Reflect.get(jsonld, "documentLoader");
  defaultFetch = globalThis.fetch;
  Reflect.set(jsonld, "documentLoader", FORBIDDEN);
  globalThis.fetch = FORBIDDEN as unknown as typeof fetch;
});

afterAll(() => {
  Reflect.set(jsonld, "documentLoader", defaultLoader);
  globalThis.fetch = defaultFetch as typeof fetch;
});

function issuerOf(key: typeof KEYS.ed25519) {
  const did = `did:key:${key.multikey}`;
  return { did, signer: signerOf(key, `${did}#${key.multikey}`) };
}

describe("the processors of JSON-LD", () => {
  it("never run without the loader of the package, in any operation", async () => {
    const clock = clockAt(NOW);
    const contexts = memoryContexts();
    const options = { clock, contexts: contexts.load };
    const eddsa = issuerOf(KEYS.ed25519);
    const credential = {
      ...achievementCredential(),
      issuer: { id: eddsa.did, type: ["Profile"] },
    } as unknown as IssuableCredential;
    const signed = await addProof(credential, eddsa.signer, options);
    const read = { keys: createKeyResolver({ clock }), clock, contexts: contexts.load };
    expect((await verifyProof(signed, read)).valid).toBe(true);
    expect(await validateJsonLd(signed, { contexts: contexts.load })).toStrictEqual([]);
    const sd = issuerOf(KEYS.es256);
    const sdCredential = {
      ...achievementCredential(),
      issuer: { id: sd.did, type: ["Profile"] },
    } as unknown as IssuableCredential;
    const base = await addProof(sdCredential, sd.signer, { ...options, cryptosuite: "ecdsa-sd-2023" });
    const disclosure = await deriveDisclosure(base, { selectivePointers: [], contexts: contexts.load });
    expect((await verifyProof(disclosure, read)).valid).toBe(true);
    expect(contexts.requested.length).toBeGreaterThan(0);
  });
});

describe("the canonicalization of a graph", () => {
  /** A clique of blank nodes that look alike: the input that makes the canonical labelling of RDF take exponential work. */
  function poison(size: number) {
    const names = Array.from({ length: size }, (_, index) => `_:n${index}`);
    return names.map((id) => ({ id, link: names.filter((other) => other !== id).map((other) => ({ id: other })) }));
  }

  /**
   * Blank nodes that look alike and are linked to nothing: each takes one run of the algorithm that tells nodes apart. The
   * default allowance of the library is one run for each node, so 1,500 of them pass it and only a fixed count refuses them.
   */
  const ALIKE = Array.from({ length: 1500 }, () => ({ note: "alike" }));

  const LIMIT = /needs more than 1000 runs of the Hash N-Degree Quads algorithm/u;

  const proof = (cryptosuite: string) => ({
    type: "DataIntegrityProof",
    cryptosuite,
    verificationMethod: "x",
    proofValue: "z1",
  });

  const SUITES = [
    ["eddsa-rdfc-2022", proof("eddsa-rdfc-2022"), KEYS.ed25519],
    ["ecdsa-rdfc-2019", proof("ecdsa-rdfc-2019"), KEYS.es256],
    ["Ed25519Signature2020", { type: "Ed25519Signature2020", verificationMethod: "x", proofValue: "z1" }, KEYS.ed25519],
  ] as const;

  it.each(SUITES)(
    "is refused by the suite %s as a limit and not as a signature that fails",
    async (name, proofOf, key) => {
      const suite = BUILT_IN_SUITES.concat(ED25519_SIGNATURE_2020).find(({ cryptosuite }) => cryptosuite === name);
      const document = {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiableCredential"],
        poison: poison(12),
      };
      await expect(
        suite?.verify(document, proofOf, { publicKeyJwk: key.publicJwk, contexts: memoryContexts().load }),
      ).rejects.toThrow(LIMIT);
    },
  );

  it.each(SUITES)(
    "stops %s after 1,000 runs, which the allowance of the library would not",
    async (name, proofOf, key) => {
      const suite = BUILT_IN_SUITES.concat(ED25519_SIGNATURE_2020).find(({ cryptosuite }) => cryptosuite === name);
      const document = {
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        type: ["VerifiableCredential"],
        extra: ALIKE,
      };
      await expect(
        suite?.verify(document, proofOf, { publicKeyJwk: key.publicJwk, contexts: memoryContexts().load }),
      ).rejects.toThrow(LIMIT);
    },
  );

  it("gives the limit as the reason of a proof that is not valid, in a time that does not grow with the list", async () => {
    const clock = clockAt(NOW);
    const issuer = issuerOf(KEYS.ed25519);
    const contexts = memoryContexts();
    const honest = await addProof(
      { ...achievementCredential(), issuer: { id: issuer.did, type: ["Profile"] } } as unknown as IssuableCredential,
      issuer.signer,
      { clock, contexts: contexts.load },
    );
    const hostile = {
      ...honest,
      extra: { "@list": Array.from({ length: 5000 }, () => 1) },
    } as unknown as IssuableCredential;
    const started = performance.now();
    const verdict = await verifyProof(hostile, { keys: createKeyResolver({ clock }), clock, contexts: contexts.load });
    expect(verdict).toMatchObject({ valid: false });
    expect(JSON.stringify(verdict)).toMatch(LIMIT);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("is refused when signing, with an error that names the limit", async () => {
    const clock = clockAt(NOW);
    const issuer = issuerOf(KEYS.ed25519);
    const base = { ...achievementCredential(), issuer: { id: issuer.did, type: ["Profile"] } };
    const heavy = { ...base, poison: poison(12) } as unknown as IssuableCredential;
    const options = { clock, contexts: memoryContexts().load };
    await expect(addProof(heavy, issuer.signer, options)).rejects.toThrow(LIMIT);
    await expect(
      addProof({ ...base, extra: ALIKE } as unknown as IssuableCredential, issuer.signer, options),
    ).rejects.toThrow(LIMIT);
    // Nodes that differ in what they say, as the nested objects of a credential do, canonicalize at once.
    const chain = Array.from({ length: 5 }, (_, index) => ({
      id: `_:c${index}`,
      label: `node ${index}`,
      link: { id: `_:c${index + 1}` },
    }));
    const light = { ...base, poison: chain } as unknown as IssuableCredential;
    expect((await addProof(light, issuer.signer, options)).proof).toBeDefined();
  });
});
