import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import { addBaseProofWith } from "../src/base/internal.js";
import { addBaseProof, isBaseProof } from "../src/index.js";
import { parseBaseProofValue } from "../src/proof-value/index.js";
import { CLOSED_CONTEXT, hangingContexts, memoryContexts, OPEN_CONTEXT } from "./contexts.js";
import { CREATED, MANDATORY_POINTERS, sampleCredential, tokensOf } from "./documents.js";
import { createIssuer, VERIFICATION_METHOD } from "./keys.js";
import { deterministicProofKey } from "./multikey.js";
import { fixRandomBytes } from "./random.js";
import { signedCredential } from "./setup.js";

/** The proof of a document that was signed. */
function proofOf(document: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return document.proof as Record<string, unknown>;
}

describe("addBaseProof", () => {
  it("adds a base proof of ecdsa-sd-2023 that names the signer's key and the time", async () => {
    const { base } = await signedCredential();
    const { proofValue, ...rest } = proofOf(base);
    expect(rest).toStrictEqual({
      type: "DataIntegrityProof",
      cryptosuite: "ecdsa-sd-2023",
      created: CREATED,
      verificationMethod: VERIFICATION_METHOD,
      proofPurpose: "assertionMethod",
    });
    expect(isBaseProof(proofOf(base))).toBe(true);
    expect(parseBaseProofValue(proofValue).mandatoryPointers).toStrictEqual(MANDATORY_POINTERS);
  });

  it("returns the document with a proof, and leaves the input as it was", async () => {
    const input = sampleCredential();
    const before = structuredClone(input);
    const issuer = await createIssuer();
    const signed = await addBaseProof(input, {
      signer: issuer.signer,
      contexts: memoryContexts().load,
      created: CREATED,
    });
    expect(input).toStrictEqual(before);
    const { proof: _proof, ...rest } = signed;
    expect(rest).toStrictEqual(before);
    expect((rest.credentialSubject as object) === input.credentialSubject).toBe(false);
  });

  it("changes nothing it is given: a frozen document and frozen options are signed", async () => {
    const issuer = await createIssuer();
    const options = deepFreeze({
      signer: issuer.signer,
      mandatoryPointers: [...MANDATORY_POINTERS],
      contexts: memoryContexts().load,
      created: CREATED,
    });
    const signed = await addBaseProof(deepFreeze(sampleCredential()), options);
    expect(isBaseProof(proofOf(signed))).toBe(true);
  });

  it("writes no created unless the caller gives one, which Data Integrity leaves optional", async () => {
    const issuer = await createIssuer();
    const signed = await addBaseProof(sampleCredential(), { signer: issuer.signer, contexts: memoryContexts().load });
    expect(Object.keys(proofOf(signed)).sort()).toStrictEqual(
      ["cryptosuite", "proofPurpose", "proofValue", "type", "verificationMethod"].sort(),
    );
  });

  it("has no mandatory pointers unless the caller names them", async () => {
    const issuer = await createIssuer();
    const signed = await addBaseProof(sampleCredential(), {
      signer: issuer.signer,
      contexts: memoryContexts().load,
      created: CREATED,
    });
    expect(parseBaseProofValue(proofOf(signed).proofValue).mandatoryPointers).toStrictEqual([]);
  });

  it("signs a statement for each one that is not mandatory", async () => {
    const mandatory = await signedCredential();
    const none = await signedCredential({ mandatoryPointers: [] });
    const everything = await signedCredential({ mandatoryPointers: [""] });
    const counts = [mandatory, none, everything].map(
      ({ base }) => parseBaseProofValue(proofOf(base).proofValue).signatures.length,
    );
    expect(counts[0]).toBeLessThan(counts[1] ?? 0);
    expect(counts[2]).toBe(0);
  });

  it("uses a new HMAC key and a new key for the proof every time", async () => {
    const first = parseBaseProofValue(proofOf((await signedCredential()).base).proofValue);
    const second = parseBaseProofValue(proofOf((await signedCredential()).base).proofValue);
    expect(second.hmacKey).not.toStrictEqual(first.hmacKey);
    expect(second.publicKey).not.toStrictEqual(first.publicKey);
  });

  it("takes the HMAC key from crypto.getRandomValues, with no option to replace it", async () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
    const restore = fixRandomBytes(key);
    try {
      const { base } = await signedCredential();
      expect(parseBaseProofValue(proofOf(base).proofValue).hmacKey).toStrictEqual(key);
    } finally {
      restore();
    }
  });

  it("signs with the secrets that the tests give it, and nowhere else", async () => {
    const issuer = await createIssuer();
    const hmacKey = new Uint8Array(32).fill(5);
    const proofKey = deterministicProofKey(new Uint8Array(32).fill(7));
    const make = () =>
      addBaseProofWith(
        sampleCredential(),
        { signer: issuer.signer, contexts: memoryContexts().load, created: CREATED },
        async () => ({ hmacKey, proofKey }),
      );
    const first = parseBaseProofValue(proofOf(await make()).proofValue);
    const second = parseBaseProofValue(proofOf(await make()).proofValue);
    expect(first.hmacKey).toStrictEqual(hmacKey);
    expect(first.publicKey).toStrictEqual(proofKey.publicKey);
    expect(second.signatures).toStrictEqual(first.signatures);
  });

  it("reads contexts only through the loader the caller passes", async () => {
    const { contexts } = await signedCredential();
    expect(new Set(contexts.requested)).toStrictEqual(new Set([OPEN_CONTEXT]));
  });
});

describe("addBaseProof, given what it cannot sign", () => {
  const options = async () => ({
    signer: (await createIssuer()).signer,
    contexts: memoryContexts().load,
    created: CREATED,
  });

  it("refuses a document that has a proof already", async () => {
    const { base } = await signedCredential();
    await expect(addBaseProof(base, await options())).rejects.toThrow("The document already has a proof");
  });

  it("refuses a document without an @context", async () => {
    const { "@context": _context, ...document } = sampleCredential();
    await expect(addBaseProof(document, await options())).rejects.toThrow("The document has no @context");
  });

  it("refuses a pointer that points at nothing, and one that is no pointer", async () => {
    await expect(
      addBaseProof(sampleCredential(), { ...(await options()), mandatoryPointers: ["/nothing"] }),
    ).rejects.toThrow('holds the pointer "/nothing", which points at nothing in the document');
    await expect(
      addBaseProof(sampleCredential(), { ...(await options()), mandatoryPointers: ["issuer"] }),
    ).rejects.toThrow('must hold JSON pointers such as "/credentialSubject/name", found "issuer"');
  });

  it("refuses a term that the contexts do not define", async () => {
    const document = { "@context": [CLOSED_CONTEXT], name: "defined", unknownTerm: "undefined" };
    await expect(addBaseProof(document, await options())).rejects.toThrow(
      /cannot be processed as JSON-LD with its contexts/,
    );
  });

  it("refuses a graph of blank nodes that takes more work to canonicalize than the work factor allows", async () => {
    const size = 14;
    const nodes = Array.from({ length: size }, (_, from) => ({
      id: `_:node${from}`,
      knows: Array.from({ length: size }, (_, to) => to)
        .filter((to) => to !== from)
        .map((to) => ({ id: `_:node${to}` })),
    }));
    const error = await addBaseProof({ "@context": [OPEN_CONTEXT], "@graph": nodes }, await options()).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(DataError);
    expect((error as Error).message).toMatch(/Maximum deep iterations exceeded/);
  });

  it("refuses blank nodes that take more than 1,000 runs of Hash N-Degree Quads to tell apart, whatever their number", async () => {
    // Each empty object is a blank node that looks like the others, and takes one run to tell apart.
    const alike = (count: number) => ({
      "@context": [OPEN_CONTEXT],
      items: Array.from({ length: count }, () => ({})),
    });
    const signed = await addBaseProof(alike(1000), await options());
    expect(signed.proof).toBeDefined();
    await expect(addBaseProof(alike(1001), await options())).rejects.toThrow(
      /Maximum deep iterations exceeded \(1000\)/,
    );
  });

  it("refuses a document that is no JSON, or nests too deep", async () => {
    await expect(addBaseProof({ ...sampleCredential(), value: undefined }, await options())).rejects.toThrow(
      /must be JSON, but value is undefined/,
    );
    let nested: Record<string, unknown> = {};
    for (let level = 0; level < 70; level += 1) nested = { next: nested };
    await expect(addBaseProof({ ...sampleCredential(), nested }, await options())).rejects.toThrow(
      /nests more than 64 levels/,
    );
  });

  it("refuses a document larger than maxBytes", async () => {
    const small = await addBaseProof(sampleCredential(), { ...(await options()), maxBytes: 100_000 });
    expect(small.proof).toBeDefined();
    await expect(addBaseProof(sampleCredential(), { ...(await options()), maxBytes: 100 })).rejects.toThrow(
      /bytes as JSON, more than the option maxBytes allows, 100/,
    );
  });

  it("refuses a document of more tokens than maxTokens, 20,000 unless the caller sets another limit", async () => {
    const tokens = tokensOf(JSON.stringify(sampleCredential()));
    const atLimit = await addBaseProof(sampleCredential(), { ...(await options()), maxTokens: tokens });
    expect(atLimit.proof).toBeDefined();
    await expect(addBaseProof(sampleCredential(), { ...(await options()), maxTokens: tokens - 1 })).rejects.toThrow(
      `more tokens of JSON than the option maxTokens allows, ${tokens - 1}`,
    );
    const large = { "@context": [OPEN_CONTEXT], items: Array.from({ length: 10_000 }, (_, index) => index) };
    await expect(addBaseProof(large, await options())).rejects.toThrow("maxTokens allows, 20000");
  });
});

describe("addBaseProof, given arguments of other types", () => {
  const good = async () => ({
    signer: (await createIssuer()).signer,
    contexts: memoryContexts().load,
    created: CREATED,
  });

  it("refuses options that are not an object", async () => {
    for (const bad of [null, undefined, "options", 7, []]) {
      await expect(addBaseProof(sampleCredential(), bad as never)).rejects.toThrow(
        /The options of addBaseProof must be an object/,
      );
    }
  });

  it("refuses a document that is not an object", async () => {
    for (const bad of [null, undefined, "document", 7, [sampleCredential()]]) {
      await expect(addBaseProof(bad as never, await good())).rejects.toThrow(/The document must be an object/);
    }
  });

  it("refuses a signer that is not an ES256 signer with a key id", async () => {
    const options = await good();
    await expect(addBaseProof(sampleCredential(), { ...options, signer: null as never })).rejects.toThrow(
      /The option signer must be an object, found null/,
    );
    await expect(
      addBaseProof(sampleCredential(), { ...options, signer: { ...options.signer, algorithm: "ES384" } }),
    ).rejects.toThrow(/must sign with ES256, the algorithm of the curve P-256, found "ES384"/);
    await expect(
      addBaseProof(sampleCredential(), { ...options, signer: { algorithm: "ES256", sign: options.signer.sign } }),
    ).rejects.toThrow(
      /The keyId of the option signer \(the verification method of the proof\) must be a non-empty string/,
    );
    await expect(
      addBaseProof(sampleCredential(), {
        ...options,
        signer: JSON.parse('{"algorithm":"ES256","keyId":"k","sign":1}'),
      }),
    ).rejects.toThrow(/The function sign of the option signer must be a function/);
  });

  it("refuses a time that is not a date and time with an offset", async () => {
    for (const created of ["yesterday", "2026-11-01", "2026-11-01T09:30:00", 20261101, null]) {
      await expect(addBaseProof(sampleCredential(), { ...(await good()), created: created as never })).rejects.toThrow(
        /The option created must be a date and time with an offset/,
      );
    }
  });

  it("refuses contexts that are not a function, a signal that is not an AbortSignal, and a limit that is not a count", async () => {
    await expect(addBaseProof(sampleCredential(), { ...(await good()), contexts: {} as never })).rejects.toThrow(
      /The option contexts must be a function/,
    );
    await expect(addBaseProof(sampleCredential(), { ...(await good()), signal: "stop" as never })).rejects.toThrow(
      /The option signal must be an AbortSignal/,
    );
    for (const limit of ["100", 0, 1.5, null]) {
      await expect(addBaseProof(sampleCredential(), { ...(await good()), maxBytes: limit as never })).rejects.toThrow(
        /The option maxBytes must be a positive integer/,
      );
      await expect(addBaseProof(sampleCredential(), { ...(await good()), maxTokens: limit as never })).rejects.toThrow(
        /The option maxTokens must be a positive integer/,
      );
    }
  });

  it("refuses pointers that are not an array of strings", async () => {
    for (const pointers of ["/issuer", { 0: "/issuer" }, null, [7], [null]]) {
      await expect(
        addBaseProof(sampleCredential(), { ...(await good()), mandatoryPointers: pointers as never }),
      ).rejects.toThrow(DataError);
    }
  });
});

describe("addBaseProof, when something it calls fails", () => {
  const signer = async () => (await createIssuer()).signer;

  it("passes on the error of the signer as it was", async () => {
    const failure = new Error("The key is in a vault that is closed.");
    const failing = { algorithm: "ES256", keyId: VERIFICATION_METHOD, sign: () => Promise.reject(failure) };
    await expect(
      addBaseProof(sampleCredential(), { signer: failing, contexts: memoryContexts().load, created: CREATED }),
    ).rejects.toBe(failure);
  });

  it("refuses a signature that is not the 64 bytes of ES256, such as DER", async () => {
    const real = await signer();
    for (const answer of [new Uint8Array(70), "signature", null]) {
      const odd = { ...real, sign: async () => answer as never };
      await expect(
        addBaseProof(sampleCredential(), { signer: odd, contexts: memoryContexts().load, created: CREATED }),
      ).rejects.toThrow(/The signer must return the signature as 64 bytes, the R and S of ES256 and not DER/);
    }
  });

  it("passes on the error of the context loader as it was, even when it is a DataError", async () => {
    for (const failure of [new Error("The network is down."), new DataError("The pin does not match.")]) {
      await expect(
        addBaseProof(sampleCredential(), {
          signer: await signer(),
          contexts: () => Promise.reject(failure),
          created: CREATED,
        }),
      ).rejects.toBe(failure);
    }
  });

  it("refuses a context that the loader does not return as an object", async () => {
    for (const context of ["text", null, 7, [{}]]) {
      await expect(
        addBaseProof(sampleCredential(), {
          signer: await signer(),
          contexts: async () => context,
          created: CREATED,
        }),
      ).rejects.toThrow(/The context loader must return the context of .* as an object/);
    }
  });

  it("gives the loader and the signer the signal, and stops waiting when it aborts", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const real = await signer();
    const watching = {
      ...real,
      sign: (data: Uint8Array, options?: { signal?: AbortSignal }) => {
        seen.push(options?.signal);
        return real.sign(data, options);
      },
    };
    await addBaseProof(sampleCredential(), {
      signer: watching,
      contexts: async (url, options) => {
        seen.push(options?.signal);
        return memoryContexts().load(url);
      },
      created: CREATED,
      signal: controller.signal,
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((signal) => signal === controller.signal)).toBe(true);
  });

  it("ends the wait with the reason of the signal when the loader never answers", async () => {
    const controller = new AbortController();
    const contexts = hangingContexts();
    const pending = addBaseProof(sampleCredential(), {
      signer: await signer(),
      contexts: contexts.load,
      created: CREATED,
      signal: controller.signal,
    });
    const reason = new Error("The caller gave up.");
    await contexts.asked;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("ends the wait with the reason of the signal when the signer never answers", async () => {
    const controller = new AbortController();
    const real = await signer();
    const pending = addBaseProof(sampleCredential(), {
      signer: { ...real, sign: () => new Promise<Uint8Array>(() => undefined) },
      contexts: memoryContexts().load,
      created: CREATED,
      signal: controller.signal,
    });
    const reason = new Error("The caller gave up.");
    setTimeout(() => controller.abort(reason), 50);
    await expect(pending).rejects.toBe(reason);
  });

  it("does not start when the signal has aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("Already aborted.");
    controller.abort(reason);
    const contexts = memoryContexts();
    await expect(
      addBaseProof(sampleCredential(), {
        signer: await signer(),
        contexts: contexts.load,
        created: CREATED,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(contexts.requested).toStrictEqual([]);
  });
});
