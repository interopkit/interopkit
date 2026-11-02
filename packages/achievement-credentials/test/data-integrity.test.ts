import { DataIntegrityProof } from "@interop/data-integrity-proof";
import { ecdsaRdfc2019 } from "@interop/ecdsa-signature";
import { eddsaRdfc2022 } from "@interop/ed25519-signature";
import jsigs from "@interop/jsonld-signatures";
import { DataError, ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { addProof, deriveDisclosure, validateJsonLd, verifyProof } from "../src/data-integrity/index.js";
import {
  defaultMandatoryPointers,
  EDDSA_RDFC_2022,
  failOperation,
  inspectProofs,
  rethrowOperational,
  withProofList,
  withProofObject,
} from "../src/data-integrity/internal.js";
import { type IssuableCredential, readCredential } from "../src/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { CLOSED, memoryContexts } from "./context-fixtures.js";
import { achievementCredential, clrCredential, endorsementCredential } from "./fixtures.js";
import { HOSTILE, neverParsesLarge } from "./hostile.js";
import { clockAt, KEYS, serve, signerOf, type TestKey } from "./key-fixtures.js";

const NOW = Date.UTC(2024, 5, 14, 12, 0, 0);

/** An issuer that is the did:key of a key, which publishes itself: the document of its method is the DID. */
function issuerOf(key: TestKey) {
  const did = `did:key:${key.multikey}`;
  return { did, method: `${did}#${key.multikey}`, signer: signerOf(key, `${did}#${key.multikey}`) };
}

/** A credential that the issuer awards. */
function credentialOf(did: string): IssuableCredential {
  return {
    ...achievementCredential(),
    description: "Awarded for the course.",
    issuer: { id: did, type: ["Profile"] },
  } as unknown as IssuableCredential;
}

const world = () => {
  const clock = clockAt(NOW);
  const contexts = memoryContexts();
  return { clock, contexts, keys: createKeyResolver({ clock }), options: { clock, contexts: contexts.load } };
};

/** The first proof of a credential, which the proof functions write as a list of one. */
const proofOf = (credential: unknown) => {
  const { proof } = credential as { proof: Record<string, unknown> | Record<string, unknown>[] };
  return (Array.isArray(proof) ? proof[0] : proof) as Record<string, unknown>;
};

describe("signing with eddsa-rdfc-2022", () => {
  const issuer = issuerOf(KEYS.ed25519);

  it("adds a proof that names the signer's key and the time of the clock, and leaves the input as it is", async () => {
    const { options } = world();
    const credential = credentialOf(issuer.did);
    const before = structuredClone(credential);
    const signed = await addProof(credential, issuer.signer, options);
    expect(credential).toStrictEqual(before);
    expect(signed).toMatchObject({ id: "https://example.edu/credentials/1" });
    expect(proofOf(signed)).toMatchObject({
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      verificationMethod: issuer.method,
      proofPurpose: "assertionMethod",
      created: "2024-06-14T12:00:00Z",
    });
    expect(proofOf(signed).proofValue).toMatch(/^z/u);
  });

  it("signs every context through the loader and no other way", async () => {
    const { options, contexts } = world();
    await addProof(credentialOf(issuer.did), issuer.signer, options);
    expect(new Set(contexts.requested)).toStrictEqual(
      new Set(["https://www.w3.org/ns/credentials/v2", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"]),
    );
  });

  it("signs an endorsement and a CLR too", async () => {
    const { options } = world();
    for (const make of [endorsementCredential, clrCredential]) {
      const value = { ...make(), issuer: { id: issuer.did, type: ["Profile"] } } as unknown as IssuableCredential;
      const signed = await addProof(value, issuer.signer, options);
      expect(proofOf(signed)).toMatchObject({ cryptosuite: "eddsa-rdfc-2022" });
    }
  });

  it("refuses a signer of another algorithm or without a key id", async () => {
    const { options } = world();
    const credential = credentialOf(issuer.did);
    await expect(addProof(credential, signerOf(KEYS.es256, issuer.method), options)).rejects.toThrow("sign with EdDSA");
    await expect(addProof(credential, signerOf(KEYS.ed25519), options)).rejects.toThrow("keyId");
  });

  it("refuses a credential that is not valid", async () => {
    const { options } = world();
    const broken = { ...credentialOf(issuer.did), validFrom: "yesterday" } as unknown as IssuableCredential;
    await expect(addProof(broken, issuer.signer, options)).rejects.toThrow("The credential is invalid");
  });

  it("passes the failure of a context and the abort of the caller", async () => {
    const { clock } = world();
    const failing = async () => {
      throw new ServiceError("The context did not answer.", 0, "");
    };
    await expect(
      addProof(credentialOf(issuer.did), issuer.signer, { clock, contexts: failing }),
    ).rejects.toBeInstanceOf(ServiceError);
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      addProof(credentialOf(issuer.did), issuer.signer, { ...world().options, signal: controller.signal }),
    ).rejects.toThrow("stop");
  });

  it("refuses a context that the loader refuses, as the loader's error", async () => {
    const { clock } = world();
    const unpinned = async () => {
      throw new DataError("The context has no pin.");
    };
    await expect(addProof(credentialOf(issuer.did), issuer.signer, { clock, contexts: unpinned })).rejects.toThrow(
      "no pin",
    );
  });
});

describe("verifying an eddsa-rdfc-2022 proof", () => {
  const issuer = issuerOf(KEYS.ed25519);

  async function signed() {
    const w = world();
    const credential = await addProof(credentialOf(issuer.did), issuer.signer, w.options);
    return { ...w, credential, read: { keys: w.keys, clock: w.clock, contexts: w.contexts.load } };
  }

  it("accepts a proof of a key that the issuer publishes, and says that the key is bound", async () => {
    const { credential, read } = await signed();
    const result = await verifyProof(credential, read);
    expect(result).toMatchObject({ valid: true, bound: true, key: { id: issuer.method } });
    if (result.valid) expect(result.credential).toStrictEqual(readCredential(credential));
  });

  it("refuses a credential that was changed after it was signed", async () => {
    const { credential, read } = await signed();
    const changed = { ...credential, name: "Another badge" } as unknown as IssuableCredential;
    expect(await verifyProof(changed, read)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("does not verify"),
    });
  });

  it("refuses a proof by another key than the one that the method names", async () => {
    const w = world();
    const forger = issuerOf(KEYS.otherEd25519);
    const forged = await addProof(credentialOf(issuer.did), { ...forger.signer, keyId: issuer.method }, w.options);
    expect(await verifyProof(forged, { keys: w.keys, clock: w.clock, contexts: w.contexts.load })).toMatchObject({
      valid: false,
      reason: expect.stringContaining("does not verify"),
    });
  });

  it("refuses a good proof by a key of another issuer, and accepts it when the host allows unbound keys", async () => {
    const w = world();
    const victim = issuerOf(KEYS.es256);
    // The attacker signs, with its own key, a credential that names the victim as the issuer.
    const forged = await addProof(credentialOf(victim.did), issuer.signer, w.options);
    const read = { keys: w.keys, clock: w.clock, contexts: w.contexts.load };
    expect(await verifyProof(forged, read)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("controlled by"),
    });
    expect(await verifyProof(forged, { ...read, allowUnboundKeys: true })).toMatchObject({ valid: true, bound: false });
  });

  it("looks nothing up for the binding when the host allows unbound keys", async () => {
    const { credential, read } = await signed();
    expect(await verifyProof(credential, { ...read, allowUnboundKeys: true })).toMatchObject({
      valid: true,
      bound: false,
    });
  });

  it("refuses a proof that is not for assertion, that names no key, that expired, or that no suite verifies", async () => {
    const { credential, read } = await signed();
    const variants: [string, Record<string, unknown>, string][] = [
      ["purpose", { proofPurpose: "authentication" }, "proofPurpose"],
      ["method", { verificationMethod: "" }, "verificationMethod"],
      ["expiry", { expires: "2024-06-14T11:00:00Z" }, "expired"],
      ["cryptosuite", { cryptosuite: "unknown-2030" }, "No suite verifies"],
      ["type", { type: "SomethingElse" }, "DataIntegrityProof"],
      ["unknown key", { verificationMethod: "did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUkhx1RKjj" }, "No key"],
    ];
    for (const [name, change, reason] of variants) {
      const changed = { ...credential, proof: { ...proofOf(credential), ...change } } as unknown as IssuableCredential;
      expect(await verifyProof(changed, read), name).toMatchObject({
        valid: false,
        reason: expect.stringContaining(reason),
      });
    }
  });

  it("refuses an Ed25519Signature2020 proof unless the host allows legacy proofs", async () => {
    const { credential, read } = await signed();
    const { cryptosuite: _modern, ...rest } = proofOf(credential);
    const legacy = { ...credential, proof: { ...rest, type: "Ed25519Signature2020" } };
    expect(await verifyProof(legacy as unknown as IssuableCredential, read)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("legacyProofs"),
    });
    const allowed = await verifyProof(legacy as unknown as IssuableCredential, { ...read, legacyProofs: true });
    expect(allowed).toMatchObject({ valid: false, reason: expect.stringContaining("does not verify") });
  });

  it("checks every proof and accepts the first that is valid, or reports the first fault", async () => {
    const { credential, read } = await signed();
    const bad = { ...proofOf(credential), proofValue: "z3FXQ" };
    const good = proofOf(credential);
    const second = { ...credential, proof: [bad, good] } as unknown as IssuableCredential;
    expect((await verifyProof(second, read)).valid).toBe(true);
    const none = { ...credential, proof: [bad, { ...bad, proofValue: "z3FXR" }] } as unknown as IssuableCredential;
    expect(await verifyProof(none, read)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("does not verify"),
    });
    const { proof: _proof, ...bare } = credential as unknown as { proof: unknown };
    const missing = bare as unknown as IssuableCredential;
    expect(await verifyProof(missing, read)).toMatchObject({ valid: false, reason: "The credential has no proof." });
  });

  it("uses a suite that the host passes for a cryptosuite of its own", async () => {
    const { credential, read } = await signed();
    const calls: string[] = [];
    const suite = {
      cryptosuite: "host-2030",
      async verify(_document: unknown, proof: Readonly<Record<string, unknown>>) {
        calls.push(String(proof.cryptosuite));
        return true;
      },
    };
    const custom = {
      ...credential,
      proof: { ...proofOf(credential), cryptosuite: "host-2030" },
    } as unknown as IssuableCredential;
    expect(await verifyProof(custom, { ...read, suites: [suite] })).toMatchObject({ valid: true, bound: true });
    expect(calls).toStrictEqual(["host-2030"]);
  });

  it("is not valid for a credential with more tokens of JSON than maxTokens, counted before the readers walk it", async () => {
    const { credential, read } = await signed();
    expect(await verifyProof(credential, { ...read, maxTokens: 50 })).toMatchObject({
      valid: false,
      reason: expect.stringContaining("more than the 50 tokens"),
    });
    const hostile = {
      ...credential,
      evidence: JSON.parse(`[${"[],".repeat(400_000)}[]]`),
    } as unknown as IssuableCredential;
    const result = await neverParsesLarge(() => verifyProof(hostile, { ...read, maxInputBytes: 5_000_000 }));
    expect(result).toMatchObject({ valid: false, reason: expect.stringContaining("more than the 1000000 tokens") });
    expect(HOSTILE.length).toBeGreaterThan(1_000_000);
  });

  it("is not valid for a credential too large or too deep, or one the model refuses", async () => {
    const { credential, read } = await signed();
    expect(await verifyProof(credential, { ...read, maxInputBytes: 100 })).toMatchObject({
      valid: false,
      reason: expect.stringContaining("more than the 100"),
    });
    expect(await verifyProof(credential, { ...read, maxDepth: 2 })).toMatchObject({
      valid: false,
      reason: expect.stringContaining("nests more than 2"),
    });
    const broken = { ...credential, validFrom: "x" } as unknown as IssuableCredential;
    expect(await verifyProof(broken, read)).toMatchObject({ valid: false });
  });

  it("passes a ServiceError of a context and refuses a context that is not pinned as a proof that is not valid", async () => {
    const { credential, read } = await signed();
    const down = async () => {
      throw new ServiceError("The context did not answer.", 0, "");
    };
    await expect(verifyProof(credential, { ...read, contexts: down })).rejects.toBeInstanceOf(ServiceError);
    const unpinned = async () => {
      throw new DataError("The context has no pin.");
    };
    expect(await verifyProof(credential, { ...read, contexts: unpinned })).toMatchObject({ valid: false });
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(verifyProof(credential, { ...read, signal: controller.signal })).rejects.toThrow("stop");
  });

  it("refuses arguments of the wrong type", async () => {
    const { credential, read } = await signed();
    await expect(verifyProof(JSON.parse("null"), read)).rejects.toBeInstanceOf(DataError);
    await expect(verifyProof(credential, JSON.parse("null"))).rejects.toBeInstanceOf(DataError);
    const bad: Record<string, string> = {
      clockSkewSeconds: '{"clockSkewSeconds":-1}',
      maxInputBytes: '{"maxInputBytes":0}',
      maxDepth: '{"maxDepth":1.5}',
      maxTokens: '{"maxTokens":0}',
      allowUnboundKeys: '{"allowUnboundKeys":"yes"}',
      legacyProofs: '{"legacyProofs":1}',
      suites: '{"suites":"x"}',
      suite: '{"suites":[{}]}',
      unnamed: '{"suites":[{"verify":null}]}',
      signal: '{"signal":"x"}',
    };
    for (const [name, text] of Object.entries(bad)) {
      await expect(verifyProof(credential, { ...read, ...JSON.parse(text) }), name).rejects.toBeInstanceOf(DataError);
    }
    await expect(
      verifyProof(credential, { ...read, suites: [{ cryptosuite: "", verify: async () => true }] }),
    ).rejects.toBeInstanceOf(DataError);
  });
});

describe("a base proof of ecdsa-sd-2023 and its disclosures", () => {
  const issuer = issuerOf(KEYS.es256);

  async function base() {
    const w = world();
    const credential = await addProof(credentialOf(issuer.did), issuer.signer, {
      ...w.options,
      cryptosuite: "ecdsa-sd-2023",
    });
    return { ...w, credential, read: { keys: w.keys, clock: w.clock, contexts: w.contexts.load } };
  }

  it("is written with ES256 and marks the required properties as mandatory", async () => {
    const { credential } = await base();
    expect(proofOf(credential)).toMatchObject({
      type: "DataIntegrityProof",
      cryptosuite: "ecdsa-sd-2023",
      verificationMethod: issuer.method,
      created: "2024-06-14T12:00:00Z",
    });
  });

  it("never reaches a verifier: the proof is not valid, and the reason says to derive a disclosure first", async () => {
    const { credential, read } = await base();
    expect(await verifyProof(credential, read)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("derive a disclosure first"),
    });
  });

  it("is derived into a disclosure that a verifier accepts, bound to the issuer", async () => {
    const { credential, read, contexts } = await base();
    const disclosure = await deriveDisclosure(credential, {
      selectivePointers: ["/description"],
      contexts: contexts.load,
    });
    expect(proofOf(disclosure)).toMatchObject({ cryptosuite: "ecdsa-sd-2023" });
    expect(await verifyProof(disclosure, read)).toMatchObject({ valid: true, bound: true });
  });

  it("is written for a credential of any class whose issuer is an address and whose subject holds only its id", async () => {
    const { options, contexts } = world();
    const w = world();
    const plain = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiableCredential"],
      issuer: issuer.did,
      validFrom: "2024-06-13T18:46:03Z",
      credentialSubject: { id: "did:example:learner" },
    } as unknown as IssuableCredential;
    const credential = await addProof(plain, issuer.signer, { ...options, cryptosuite: "ecdsa-sd-2023" });
    const disclosure = await deriveDisclosure(credential, { selectivePointers: [], contexts: contexts.load });
    expect(await verifyProof(disclosure, { keys: w.keys, clock: w.clock, contexts: contexts.load })).toMatchObject({
      valid: true,
      bound: true,
    });
  });

  it("is refused as a disclosure that hides what the model requires, and the reason names the fix", async () => {
    const { options, contexts } = world();
    const bare = await addProof(credentialOf(issuer.did), issuer.signer, {
      ...options,
      cryptosuite: "ecdsa-sd-2023",
      mandatoryPointers: ["/@context", "/type"],
    });
    await expect(deriveDisclosure(bare, { selectivePointers: ["/id"], contexts: contexts.load })).rejects.toThrow(
      /The disclosure is invalid.*Add the pointers of what the model requires to selectivePointers/su,
    );
  });

  it("passes the failure of a context while deriving, and refuses a signal that is not one", async () => {
    const { credential, contexts } = await base();
    const down = async () => {
      throw new ServiceError("The context did not answer.", 0, "");
    };
    await expect(deriveDisclosure(credential, { selectivePointers: [], contexts: down })).rejects.toBeInstanceOf(
      ServiceError,
    );
    const bad = JSON.parse('{"signal":1}');
    await expect(
      deriveDisclosure(credential, { selectivePointers: [], contexts: contexts.load, ...bad }),
    ).rejects.toBeInstanceOf(DataError);
  });

  it("refuses options of the wrong type", async () => {
    const { credential, contexts } = await base();
    await expect(deriveDisclosure(credential, JSON.parse("null"))).rejects.toBeInstanceOf(DataError);
    await expect(
      deriveDisclosure(credential, { contexts: contexts.load, ...JSON.parse('{"selectivePointers":"x"}') }),
    ).rejects.toBeInstanceOf(DataError);
    await expect(
      deriveDisclosure(credential, { contexts: contexts.load, ...JSON.parse('{"selectivePointers":["a"]}') }),
    ).rejects.toBeInstanceOf(DataError);
    await expect(
      deriveDisclosure(JSON.parse("null"), { selectivePointers: [], contexts: contexts.load }),
    ).rejects.toBeInstanceOf(DataError);
    const { options } = world();
    await expect(
      addProof(credential, issuer.signer, { ...options, ...JSON.parse('{"cryptosuite":"none"}') }),
    ).rejects.toBeInstanceOf(DataError);
    await expect(
      addProof(credential, issuer.signer, { ...options, ...JSON.parse('{"mandatoryPointers":["x"]}') }),
    ).rejects.toBeInstanceOf(DataError);
    await expect(addProof(credential, issuer.signer, JSON.parse("null"))).rejects.toBeInstanceOf(DataError);
    await expect(
      addProof(credential, issuer.signer, { ...options, ...JSON.parse('{"signal":"x"}') }),
    ).rejects.toBeInstanceOf(DataError);
  });
});

describe("JSON-LD safe mode", () => {
  const closed = (extra: object = {}) =>
    ({
      "@context": [CLOSED],
      id: "https://example.test/a",
      type: "Thing",
      name: "x",
      ...extra,
    }) as unknown as IssuableCredential;

  it("finds nothing in a credential whose terms the contexts define", async () => {
    const { contexts } = world();
    expect(await validateJsonLd(closed(), { contexts: contexts.load })).toStrictEqual([]);
  });

  it("lists a property that no context defines, with where it is", async () => {
    const { contexts } = world();
    const issues = await validateJsonLd(closed({ extra: 1, nested: [{ other: 2 }] }), { contexts: contexts.load });
    expect(issues.map(({ term, path }) => [term, path])).toStrictEqual([
      ["extra", "/extra"],
      ["nested", "/nested"],
    ]);
    expect(issues[0]?.message).toContain("Dropping property");
  });

  it("finds a property inside the value of a term that the context defines", async () => {
    const { contexts } = world();
    const issues = await validateJsonLd(closed({ name: { id: "https://example.test/b", extra: 1 } }), {
      contexts: contexts.load,
    });
    expect(issues.map(({ term, path }) => [term, path])).toStrictEqual([["extra", "/name/extra"]]);
  });

  it("lists a relative id", async () => {
    const { contexts } = world();
    const issues = await validateJsonLd(closed({ id: "relative" }), { contexts: contexts.load });
    expect(issues.map(({ term }) => term)).toContain("relative");
  });

  it("reports at most 100 findings", async () => {
    const { contexts } = world();
    const many = Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`term${index}`, index]));
    expect(await validateJsonLd(closed(many), { contexts: contexts.load })).toHaveLength(100);
  });

  it("passes the failure of a context, the abort of the caller, and refuses arguments of the wrong type", async () => {
    const down = async () => {
      throw new ServiceError("The context did not answer.", 0, "");
    };
    await expect(validateJsonLd(closed(), { contexts: down })).rejects.toBeInstanceOf(ServiceError);
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      validateJsonLd(closed(), { contexts: world().contexts.load, signal: controller.signal }),
    ).rejects.toThrow("stop");
    await expect(validateJsonLd(JSON.parse("null"), { contexts: world().contexts.load })).rejects.toBeInstanceOf(
      DataError,
    );
    await expect(validateJsonLd(closed(), JSON.parse("null"))).rejects.toBeInstanceOf(DataError);
    await expect(validateJsonLd(closed(), JSON.parse('{"contexts":5}'))).rejects.toBeInstanceOf(DataError);
    await expect(
      validateJsonLd(closed(), { contexts: world().contexts.load, ...JSON.parse('{"signal":1}') }),
    ).rejects.toBeInstanceOf(DataError);
  });
});

describe("what the glue finds under the error of a processor", () => {
  it("is the failure of a service wherever it sits: as the cause, or in the details of the error", () => {
    const service = new ServiceError("The context did not answer.", 0, "");
    expect(() => rethrowOperational(new Error("wrapped", { cause: service }))).toThrow(service);
    const withDetails = Object.assign(new Error("wrapped"), { details: { cause: service } });
    expect(() => rethrowOperational(withDetails)).toThrow(service);
    expect(() => rethrowOperational(new Error("another"))).not.toThrow();
    expect(() => rethrowOperational("not an error")).not.toThrow();
  });

  it("is the reason of the signal when the caller aborted", () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    expect(() => rethrowOperational(new Error("anything"), controller.signal)).toThrow("stop");
  });
});

describe("the mandatory pointers of a credential", () => {
  it("are the required properties that it holds, and none of those it lacks", () => {
    const credential = { ...achievementCredential(), issuer: "https://example.edu/issuers/1" };
    const pointers = defaultMandatoryPointers(credential);
    expect(pointers).toContain("/validFrom");
    expect(pointers).toContain("/credentialSubject/achievement/criteria");
    expect(pointers).not.toContain("/issuer/id");
    expect(pointers).not.toContain("/credentialSubject/identifier");
  });

  it("name an issuer that is an address as a whole, and a subject that holds only its id as a whole", () => {
    const credential = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiableCredential"],
      issuer: "https://example.edu/issuers/1",
      validFrom: "2024-06-13T18:46:03Z",
      credentialSubject: { id: "did:example:learner" },
    };
    expect(defaultMandatoryPointers(credential)).toStrictEqual([
      "/@context",
      "/type",
      "/issuer",
      "/validFrom",
      "/credentialSubject",
    ]);
    const described = { ...credential, credentialSubject: { id: "did:example:learner", name: "Learner" } };
    expect(defaultMandatoryPointers(described)).toContain("/credentialSubject/id");
    expect(defaultMandatoryPointers(described)).not.toContain("/credentialSubject");
  });

  it("leave out the achievement of a CLR and of an endorsement, whose subjects have none", () => {
    for (const make of [clrCredential, endorsementCredential]) {
      expect(defaultMandatoryPointers(make()).some((pointer) => pointer.includes("/achievement/"))).toBe(false);
    }
  });
});

describe("an ecdsa-rdfc-2019 proof", () => {
  it("is verified with the key of a P-256 did:key that the issuer publishes", async () => {
    const issuer = issuerOf(KEYS.es256);
    const w = world();
    const credential = credentialOf(issuer.did);
    const signature = new DataIntegrityProof({
      cryptosuite: ecdsaRdfc2019,
      date: NOW,
      signer: {
        id: issuer.method,
        algorithm: "P-256",
        sign: ({ data }: { data: Uint8Array }) => issuer.signer.sign(data),
      } as never,
    });
    const signed = (await jsigs.sign(structuredClone(credential), {
      suite: signature,
      purpose: new jsigs.purposes.AssertionProofPurpose(),
      documentLoader: async (url: string) => ({
        contextUrl: null,
        documentUrl: url,
        document: await w.contexts.load(url),
      }),
    } as never)) as unknown as IssuableCredential;
    expect(proofOf(signed)).toMatchObject({ cryptosuite: "ecdsa-rdfc-2019" });
    const read = { keys: w.keys, clock: w.clock, contexts: w.contexts.load };
    expect(await verifyProof(signed, read)).toMatchObject({ valid: true, bound: true });
    const changed = { ...signed, name: "Another badge" } as unknown as IssuableCredential;
    expect((await verifyProof(changed, read)).valid).toBe(false);
  });
});

describe("a proof that names a previous proof", () => {
  it("is refused with the reason, since a proof chain is not verified and the proof is not secured until the proofs it names are", async () => {
    const issuer = issuerOf(KEYS.ed25519);
    const w = world();
    const signature = new DataIntegrityProof({
      cryptosuite: eddsaRdfc2022,
      date: NOW,
      signer: {
        id: issuer.method,
        algorithm: "Ed25519",
        sign: ({ data }: { data: Uint8Array }) => issuer.signer.sign(data),
      } as never,
    });
    // A proof that names a previousProof signs it with the rest of its options, as the algorithm of a proof chain does.
    signature.proof = { previousProof: "urn:uuid:26329423-bec9-4b2e-88cb-a7c7d9dc4544" };
    const signed = (await jsigs.sign(structuredClone(credentialOf(issuer.did)), {
      suite: signature,
      purpose: new jsigs.purposes.AssertionProofPurpose(),
      documentLoader: async (url: string) => ({
        contextUrl: null,
        documentUrl: url,
        document: await w.contexts.load(url),
      }),
    } as never)) as unknown as IssuableCredential;
    expect(proofOf(signed)).toMatchObject({ previousProof: "urn:uuid:26329423-bec9-4b2e-88cb-a7c7d9dc4544" });
    const read = { keys: w.keys, clock: w.clock, contexts: w.contexts.load };
    expect(await verifyProof(signed, read)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("previousProof"),
    });
  });
});

describe("the proofs of a document", () => {
  it("are a list of one when there is one proof, and an object when the processors of ecdsa-sd-2023 read it", () => {
    const proof = { type: "DataIntegrityProof" };
    expect(withProofList({ a: 1, proof })).toStrictEqual({ a: 1, proof: [proof] });
    expect(withProofList({ a: 1, proof: [proof] })).toStrictEqual({ a: 1, proof: [proof] });
    expect(withProofList({ a: 1 })).toStrictEqual({ a: 1 });
    expect(withProofObject({ a: 1, proof: [proof] })).toStrictEqual({ a: 1, proof });
    const two = { a: 1, proof: [proof, proof] };
    expect(withProofObject(two)).toBe(two);
  });
});

describe("what a failed operation means to the caller", () => {
  it("is a DataError that names the message of the processor, or the value that was thrown", () => {
    expect(() => failOperation(new Error("a graph"))).toThrow("cannot be processed as JSON-LD: a graph");
    expect(() => failOperation("text")).toThrow("cannot be processed as JSON-LD: text");
    expect(() => failOperation(Object.assign(new Error("wrapped"), { details: 5 }))).toThrow("wrapped");
  });
});

describe("a suite that is given a proof with no verification method", () => {
  it("does not verify it", async () => {
    const document = { "@context": ["https://www.w3.org/ns/credentials/v2"], type: ["VerifiableCredential"] };
    const verdict = await EDDSA_RDFC_2022.verify(
      document,
      { type: "DataIntegrityProof", proofValue: "z1" },
      {
        publicKeyJwk: KEYS.ed25519.publicJwk,
        contexts: memoryContexts().load,
      },
    );
    expect(verdict).toBe(false);
  });
});

describe("looking at the proofs of a credential that has been read", () => {
  const issuer = issuerOf(KEYS.ed25519);

  async function signed() {
    const { keys, clock, contexts, options } = world();
    const credential = await addProof(credentialOf(issuer.did), issuer.signer, options);
    const check = (document: unknown, extra: Record<string, unknown> = {}) =>
      inspectProofs(document as Record<string, unknown>, readCredential(document, { kind: "AchievementCredential" }), {
        keys,
        clock,
        contexts: contexts.load,
        ...extra,
      });
    return { credential, check };
  }

  it("gives the key that verified the proof and leaves the key unbound when the caller says so", async () => {
    const { credential, check } = await signed();
    const verdict = await check(credential, { allowUnboundKeys: true });
    expect(verdict).toMatchObject({ valid: true, bound: false, key: { id: issuer.method } });
  });

  it("says that a proof is not valid when it does not verify, and that it is unavailable when no suite checks it", async () => {
    const { credential, check } = await signed();
    expect(await check({ ...credential, name: "Changed" })).toMatchObject({ valid: false, unavailable: false });
    const [proof] = (credential as unknown as { proof: Record<string, unknown>[] }).proof;
    const foreign = { ...credential, proof: [{ ...proof, cryptosuite: "eddsa-jcs-2022" }] };
    const verdict = await check(foreign);
    expect(verdict).toMatchObject({ valid: false, unavailable: true });
    const { proof: _proof, ...unsigned } = credential as unknown as Record<string, unknown>;
    expect(await check(unsigned)).toMatchObject({
      valid: false,
      unavailable: false,
      reason: "The credential has no proof.",
    });
    const legacy = { ...credential, proof: [{ ...proof, type: "Ed25519Signature2020" }] };
    expect(await check(legacy)).toMatchObject({ valid: false, unavailable: false });
  });

  it("rejects with the ServiceError of a key that cannot be read, which the caller turns into an unavailable proof", async () => {
    const { credential } = await signed();
    const { fetch } = serve({ "https://example.edu/keys/1": 503 });
    const keys = createKeyResolver({ clock: clockAt(NOW), fetch });
    const [proof] = (credential as unknown as { proof: Record<string, unknown>[] }).proof;
    const moved = { ...credential, proof: [{ ...proof, verificationMethod: "https://example.edu/keys/1" }] };
    await expect(
      inspectProofs(
        moved as unknown as Record<string, unknown>,
        readCredential(moved, { kind: "AchievementCredential" }),
        {
          keys,
          clock: clockAt(NOW),
          contexts: world().contexts.load,
        },
      ),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("refuses an option that is not valid, as verifyProof does", async () => {
    const { credential } = await signed();
    await expect(
      inspectProofs(
        credential as unknown as Record<string, unknown>,
        readCredential(credential, { kind: "AchievementCredential" }),
        {
          keys: createKeyResolver({ clock: clockAt(NOW) }),
          clock: clockAt(NOW),
          contexts: "loader" as never,
        },
      ),
    ).rejects.toBeInstanceOf(DataError);
  });
});
