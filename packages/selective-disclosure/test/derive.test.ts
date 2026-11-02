import { DataError } from "@interopkit/core";
import { base64urlnopad } from "@scure/base";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import { addBaseProof, deriveProof, isBaseProof } from "../src/index.js";
import { parseBaseProofValue, parseDerivedProofValue } from "../src/proof-value/index.js";
import { hangingContexts, memoryContexts } from "./contexts.js";
import { CREATED, MANDATORY_POINTERS, SELECTIVE_POINTERS, sampleCredential, tokensOf } from "./documents.js";
import { createIssuer } from "./keys.js";
import { disclosure, signedCredential } from "./setup.js";

describe("deriveProof", () => {
  it("reveals the mandatory parts and the chosen parts, and nothing else", async () => {
    const { derived } = await disclosure();
    expect(derived).toMatchObject({
      type: ["VerifiableCredential", "ExampleCredential"],
      issuer: { id: "did:example:issuer", name: "Example Academy" },
      credentialSubject: { name: "Sam Taylor", achievements: [{ name: "Algebra", score: 91 }] },
    });
    const text = JSON.stringify(derived);
    for (const hidden of ["2001-05-17", "Bandung", "Geometry", "validFrom"]) expect(text).not.toContain(hidden);
  });

  it("reveals only the mandatory parts when nothing is chosen", async () => {
    const { derived } = await disclosure([]);
    expect(derived.issuer).toStrictEqual({ id: "did:example:issuer", name: "Example Academy" });
    expect(JSON.stringify(derived)).not.toContain("Sam Taylor");
  });

  it("keeps the proof options of the base proof and replaces its value", async () => {
    const { base, derived } = await disclosure();
    const { proofValue: baseValue, ...baseOptions } = base.proof as Record<string, unknown>;
    const { proofValue: derivedValue, ...derivedOptions } = derived.proof as Record<string, unknown>;
    expect(derivedOptions).toStrictEqual(baseOptions);
    expect(derivedValue).not.toBe(baseValue);
    expect(isBaseProof(derived.proof as object)).toBe(false);
    expect(parseDerivedProofValue(derivedValue).mandatoryIndexes.length).toBeGreaterThan(0);
  });

  it("keeps the signature of the issuer and the key of the proof, and drops the HMAC key and the signatures it hides", async () => {
    const { base, derived } = await disclosure();
    const hidden = parseBaseProofValue((base.proof as Record<string, unknown>).proofValue);
    const shown = parseDerivedProofValue((derived.proof as Record<string, unknown>).proofValue);
    expect(shown.baseSignature).toStrictEqual(hidden.baseSignature);
    expect(shown.publicKey).toStrictEqual(hidden.publicKey);
    expect(shown.signatures.length).toBeLessThan(hidden.signatures.length);
    expect(hidden.signatures).toEqual(expect.arrayContaining([...shown.signatures]));
    const value = base64urlnopad.decode(String((derived.proof as Record<string, unknown>).proofValue).slice(1));
    const hmacKeyText = Buffer.from(hidden.hmacKey).toString("latin1");
    expect(Buffer.from(value).toString("latin1")).not.toContain(hmacKeyText);
  });

  it("makes disclosures of one credential that a verifier can link: they share the signature and the key", async () => {
    const { base, contexts } = await signedCredential();
    const first = await deriveProof(base, { selectivePointers: ["/credentialSubject/name"], contexts: contexts.load });
    const second = await deriveProof(base, {
      selectivePointers: ["/credentialSubject/birthDate"],
      contexts: contexts.load,
    });
    const [one, two] = [first, second].map((document) =>
      parseDerivedProofValue((document.proof as Record<string, unknown>).proofValue),
    );
    expect(one?.baseSignature).toStrictEqual(two?.baseSignature);
    expect(one?.publicKey).toStrictEqual(two?.publicKey);
  });

  it("changes nothing it is given: a frozen document and frozen options are derived from", async () => {
    const { base, contexts } = await signedCredential();
    const derived = await deriveProof(deepFreeze(structuredClone(base)), {
      selectivePointers: deepFreeze([...SELECTIVE_POINTERS]),
      contexts: contexts.load,
    });
    expect(isBaseProof(derived.proof)).toBe(false);
  });

  it("leaves the input as it was and shares nothing with it", async () => {
    const { base, contexts } = await signedCredential();
    const before = structuredClone(base);
    const derived = await deriveProof(base, { selectivePointers: SELECTIVE_POINTERS, contexts: contexts.load });
    expect(base).toStrictEqual(before);
    expect(derived.issuer === base.issuer).toBe(false);
    expect(derived.proof === base.proof).toBe(false);
  });

  it("reads contexts only through the loader the caller passes", async () => {
    const { base, contexts } = await signedCredential();
    const fresh = memoryContexts();
    await deriveProof(base, { selectivePointers: SELECTIVE_POINTERS, contexts: fresh.load });
    expect(fresh.requested.length).toBeGreaterThan(0);
    expect(new Set(fresh.requested)).toStrictEqual(new Set(contexts.requested));
  });
});

describe("deriveProof, given what it cannot derive from", () => {
  it("refuses a document without a proof, or with more than one", async () => {
    const { base, contexts } = await signedCredential();
    const { proof, ...bare } = base;
    await expect(deriveProof(bare, { selectivePointers: [], contexts: contexts.load })).rejects.toThrow(
      "The document must have one proof, as an object, found undefined",
    );
    await expect(
      deriveProof({ ...bare, proof: [proof] }, { selectivePointers: [], contexts: contexts.load }),
    ).rejects.toThrow("found an array");
  });

  it("refuses a derived proof, which cannot be derived again, and a proof of another suite", async () => {
    const { derived, contexts } = await disclosure();
    await expect(deriveProof(derived, { selectivePointers: [], contexts: contexts.load })).rejects.toThrow(
      /must be a base proof of ecdsa-sd-2023.* A derived proof cannot be derived again/,
    );
    const other = { ...derived, proof: { ...(derived.proof as object), cryptosuite: "ecdsa-rdfc-2019" } };
    await expect(deriveProof(other, { selectivePointers: [], contexts: contexts.load })).rejects.toThrow(
      /its cryptosuite is "ecdsa-rdfc-2019"/,
    );
  });

  it("refuses a base proof whose value does not parse", async () => {
    const { base, contexts } = await signedCredential();
    const broken = { ...base, proof: { ...(base.proof as object), proofValue: "u2V0AAAAA" } };
    await expect(deriveProof(broken, { selectivePointers: ["/issuer"], contexts: contexts.load })).rejects.toThrow(
      /does not hold valid CBOR/,
    );
  });

  it("refuses when nothing is selected: no mandatory pointers and no chosen ones", async () => {
    const { base, contexts } = await signedCredential({ mandatoryPointers: [] });
    await expect(deriveProof(base, { selectivePointers: [], contexts: contexts.load })).rejects.toThrow(
      "Nothing is selected to reveal",
    );
  });

  it("refuses a proof that does not belong to the document", async () => {
    const { base, contexts } = await signedCredential();
    const longer = {
      ...base,
      credentialSubject: { ...(base.credentialSubject as object), nickname: "Sammy" },
    };
    await expect(deriveProof(longer, { selectivePointers: ["/issuer"], contexts: contexts.load })).rejects.toThrow(
      /does not belong to this document/,
    );
  });

  it("refuses a pointer of the base proof that points at nothing in the document", async () => {
    const { base, contexts } = await signedCredential();
    const { issuer: _issuer, ...without } = base;
    await expect(deriveProof(without, { selectivePointers: ["/validFrom"], contexts: contexts.load })).rejects.toThrow(
      /The mandatoryPointers of the base proof holds the pointer "\/issuer", which points at nothing/,
    );
  });
});

describe("deriveProof, given pointers", () => {
  it("refuses a pointer that points at nothing", async () => {
    const { base, contexts } = await signedCredential();
    for (const pointer of ["/nothing", "/credentialSubject/achievements/2", "/credentialSubject/name/0", "/issuer/"]) {
      await expect(deriveProof(base, { selectivePointers: [pointer], contexts: contexts.load })).rejects.toThrow(
        `The option selectivePointers holds the pointer ${JSON.stringify(pointer)}, which points at nothing in the document`,
      );
    }
  });

  it("refuses a pointer of millions of characters with a DataError, reading it once", async () => {
    const { base, contexts } = await signedCredential();
    for (const pointer of [
      `/${"a".repeat(10_000_000)}`,
      `/${"~0".repeat(5_000_000)}`,
      `/${"a".repeat(10_000_000)}~2`,
    ]) {
      const result = await deriveProof(base, { selectivePointers: [pointer], contexts: contexts.load }).catch(
        (error: unknown) => error,
      );
      expect(result).toBeInstanceOf(DataError);
    }
  });

  it("refuses a text that is no JSON pointer, because the primitives would read it as the pointer to the whole document", async () => {
    const { base, contexts } = await signedCredential();
    for (const pointer of ["credentialSubject", "credentialSubject/name", "#/issuer", "/a~2b", "/a~", "", "/~"]) {
      const result = await deriveProof(base, { selectivePointers: [pointer], contexts: contexts.load }).catch(
        (error: unknown) => error,
      );
      if (pointer === "") {
        // The empty pointer is a JSON pointer, and it names the whole document.
        expect(result).toMatchObject({ credentialSubject: { birthDate: "2001-05-17" } });
      } else {
        expect(result).toBeInstanceOf(DataError);
        expect((result as Error).message).toMatch(/must hold JSON pointers such as/);
      }
    }
  });

  it("reads the escapes ~0 and ~1 and the indexes of arrays", async () => {
    const { base, contexts } = await signedCredential();
    const derived = await deriveProof(base, {
      selectivePointers: ["/credentialSubject/achievements/1/name"],
      contexts: contexts.load,
    });
    expect(JSON.stringify(derived)).toContain("Geometry");
    expect(JSON.stringify(derived)).not.toContain("Algebra");
  });

  it("refuses an array index that is not written as one", async () => {
    const { base, contexts } = await signedCredential();
    for (const index of ["01", "+1", "1.0", "-0", "1e0", "0x1"]) {
      await expect(
        deriveProof(base, { selectivePointers: [`/credentialSubject/achievements/${index}`], contexts: contexts.load }),
      ).rejects.toThrow(/points at nothing in the document|would be read as the index/);
    }
  });

  it("refuses a name that the primitives would read as an array index, as another member than it names", async () => {
    const issuer = await createIssuer();
    const contexts = memoryContexts();
    const document = { ...sampleCredential(), "1abc": "text", 1: "one" };
    const base = await addBaseProof(document, { signer: issuer.signer, contexts: contexts.load, created: CREATED });
    await expect(deriveProof(base, { selectivePointers: ["/1abc"], contexts: contexts.load })).rejects.toThrow(
      'the token "1abc" would be read as the index 1',
    );
    const derived = await deriveProof(base, { selectivePointers: ["/1"], contexts: contexts.load });
    expect(derived[1]).toBe("one");
  });

  it("selects a member whose name holds a slash or a tilde", async () => {
    const issuer = await createIssuer();
    const contexts = memoryContexts();
    const document = { ...sampleCredential(), "a/b": "slash", "c~d": "tilde" };
    const base = await addBaseProof(document, {
      signer: issuer.signer,
      mandatoryPointers: ["/issuer"],
      contexts: contexts.load,
      created: CREATED,
    });
    const derived = await deriveProof(base, { selectivePointers: ["/a~1b", "/c~0d"], contexts: contexts.load });
    expect(derived["a/b"]).toBe("slash");
    expect(derived["c~d"]).toBe("tilde");
  });

  it("refuses pointers that are not an array", async () => {
    const { base, contexts } = await signedCredential();
    for (const pointers of ["/issuer", null, undefined, { 0: "/issuer" }, [1], [null]]) {
      await expect(
        deriveProof(base, { selectivePointers: pointers as never, contexts: contexts.load }),
      ).rejects.toThrow(DataError);
    }
  });
});

describe("deriveProof, given arguments of other types", () => {
  it("refuses options that are not an object, and a document that is not", async () => {
    const { base, contexts } = await signedCredential();
    for (const bad of [null, undefined, "options", 7, []]) {
      await expect(deriveProof(base, bad as never)).rejects.toThrow(/The options of deriveProof must be an object/);
    }
    for (const bad of [null, undefined, "document", 7, [base]]) {
      await expect(deriveProof(bad as never, { selectivePointers: [], contexts: contexts.load })).rejects.toThrow(
        /The document must be an object/,
      );
    }
    await expect(deriveProof(base, JSON.parse('{"selectivePointers":["/issuer"],"contexts":"url"}'))).rejects.toThrow(
      /The option contexts must be a function/,
    );
  });

  it("refuses a document larger than maxBytes or maxTokens, and a limit that is not a count", async () => {
    const { base, contexts } = await signedCredential();
    await expect(deriveProof(base, { selectivePointers: [], contexts: contexts.load, maxBytes: 100 })).rejects.toThrow(
      /bytes as JSON, more than the option maxBytes allows, 100/,
    );
    const tokens = tokensOf(JSON.stringify(base));
    const atLimit = await deriveProof(base, { selectivePointers: [], contexts: contexts.load, maxTokens: tokens });
    expect(atLimit.proof).toBeDefined();
    await expect(
      deriveProof(base, { selectivePointers: [], contexts: contexts.load, maxTokens: tokens - 1 }),
    ).rejects.toThrow(`more tokens of JSON than the option maxTokens allows, ${tokens - 1}`);
    await expect(
      deriveProof(base, { selectivePointers: [], contexts: contexts.load, maxBytes: "100" as never }),
    ).rejects.toThrow(/The option maxBytes must be a positive integer/);
    await expect(deriveProof(base, { selectivePointers: [], contexts: contexts.load, maxTokens: 0 })).rejects.toThrow(
      /The option maxTokens must be a positive integer/,
    );
  });

  it("refuses a document that is no JSON", async () => {
    const { base, contexts } = await signedCredential();
    await expect(
      deriveProof({ ...base, value: () => 1 }, { selectivePointers: MANDATORY_POINTERS, contexts: contexts.load }),
    ).rejects.toThrow(/must be JSON, but value is a function/);
  });
});

describe("deriveProof, when the context loader fails or the caller gives up", () => {
  it("passes on the error of the loader as it was", async () => {
    const { base } = await signedCredential();
    const failure = new Error("The network is down.");
    await expect(
      deriveProof(base, { selectivePointers: SELECTIVE_POINTERS, contexts: () => Promise.reject(failure) }),
    ).rejects.toBe(failure);
  });

  it("ends the wait with the reason of the signal when the loader never answers", async () => {
    const { base } = await signedCredential();
    const controller = new AbortController();
    const contexts = hangingContexts();
    const pending = deriveProof(base, {
      selectivePointers: SELECTIVE_POINTERS,
      contexts: contexts.load,
      signal: controller.signal,
    });
    const reason = new Error("The caller gave up.");
    await contexts.asked;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("does not start when the signal has aborted", async () => {
    const { base, contexts } = await signedCredential();
    const controller = new AbortController();
    const reason = new Error("Already aborted.");
    controller.abort(reason);
    await expect(
      deriveProof(base, { selectivePointers: SELECTIVE_POINTERS, contexts: contexts.load, signal: controller.signal }),
    ).rejects.toBe(reason);
  });
});
