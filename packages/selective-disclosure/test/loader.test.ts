import { DataError } from "@interopkit/core";
import jsonld from "jsonld";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProcessing } from "../src/document/index.js";
import { addBaseProof, deriveProof, selectiveDisclosureSuite } from "../src/index.js";
import { memoryContexts, OPEN_CONTEXT } from "./contexts.js";
import { CREATED, MANDATORY_POINTERS, SELECTIVE_POINTERS, sampleCredential } from "./documents.js";
import { createIssuer } from "./keys.js";

/** The URLs that the default loader of `jsonld` was asked for. It fails, as a host that has no network would. */
const reached: string[] = [];
const defaultLoader = jsonld.documentLoader;

beforeEach(() => {
  reached.length = 0;
  jsonld.documentLoader = async (url: string) => {
    reached.push(url);
    throw new Error(`The default loader of jsonld was asked for ${url}.`);
  };
  vi.stubGlobal("fetch", async (input: unknown) => {
    reached.push(String(input));
    throw new Error("The network was used.");
  });
});

afterEach(() => {
  jsonld.documentLoader = defaultLoader;
  vi.unstubAllGlobals();
});

describe("the loader of contexts", () => {
  it("is the one the test wires: a call of jsonld without a loader reaches the default one", async () => {
    await expect(jsonld.expand({ "@context": OPEN_CONTEXT, id: "https://example.test/x" })).rejects.toThrow(
      /Dereferencing a URL did not result in a valid JSON-LD object/,
    );
    expect(reached).toStrictEqual([OPEN_CONTEXT]);
  });

  it("is the only way a context is read by the base proof, the derived proof and the verification", async () => {
    const issuer = await createIssuer();
    const contexts = memoryContexts();
    const base = await addBaseProof(sampleCredential(), {
      signer: issuer.signer,
      mandatoryPointers: MANDATORY_POINTERS,
      contexts: contexts.load,
      created: CREATED,
    });
    const derived = await deriveProof(base, { selectivePointers: SELECTIVE_POINTERS, contexts: contexts.load });
    const { proof, ...document } = derived;
    const verified = await selectiveDisclosureSuite.verify(document, proof as Record<string, unknown>, {
      publicKeyJwk: issuer.publicKeyJwk,
      contexts: contexts.load,
    });
    expect(verified).toBe(true);
    expect(contexts.requested).toContain(OPEN_CONTEXT);
    expect(reached).toStrictEqual([]);
  });

  it("is the only way a context is read when the verification refuses the proof", async () => {
    const issuer = await createIssuer();
    const contexts = memoryContexts();
    const base = await addBaseProof(sampleCredential(), {
      signer: issuer.signer,
      mandatoryPointers: MANDATORY_POINTERS,
      contexts: contexts.load,
      created: CREATED,
    });
    const { proof, ...document } = base;
    const verified = await selectiveDisclosureSuite.verify(document, proof as Record<string, unknown>, {
      publicKeyJwk: issuer.publicKeyJwk,
      contexts: contexts.load,
    });
    expect(verified).toBe(false);
    expect(reached).toStrictEqual([]);
  });

  it("reads a context that the document names through the caller's loader and nowhere else", async () => {
    const issuer = await createIssuer();
    const contexts = memoryContexts(
      new Map([["https://attacker.example/context", { "@context": { "@vocab": "https://attacker.example/#" } }]]),
    );
    const document = { ...sampleCredential(), "@context": [OPEN_CONTEXT, "https://attacker.example/context"] };
    await addBaseProof(document, { signer: issuer.signer, contexts: contexts.load, created: CREATED });
    expect(contexts.requested).toContain("https://attacker.example/context");
    expect(reached).toStrictEqual([]);
  });
});

describe("what the processors throw", () => {
  it("is a DataError that says it in a sentence, whatever the processors threw", async () => {
    const processing = createProcessing(async () => ({}));
    for (const [thrown, sentence] of [
      [new Error("A term is undefined."), "A term is undefined."],
      [new Error("A term is undefined"), "A term is undefined."],
      ["text", "text."],
    ] as const) {
      await expect(processing.wait(Promise.reject(thrown))).rejects.toThrow(
        `The document cannot be processed as JSON-LD with its contexts: ${sentence}`,
      );
    }
  });

  it("is waited for only until the caller's signal aborts, and the work goes on", async () => {
    const controller = new AbortController();
    const processing = createProcessing(async () => ({}), controller.signal);
    let finish: (value: string) => void = () => undefined;
    const work = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const waiting = processing.wait(work);
    const reason = new Error("The caller gave up.");
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    expect(processing.callerFailed()).toBe(true);
    finish("done");
    expect(await work).toBe("done");
  });

  it("is not a failure of the caller, which the caller sees as it was", async () => {
    const processing = createProcessing(async () => ({}));
    await expect(processing.wait(Promise.reject(new Error("x")))).rejects.toBeInstanceOf(DataError);
    expect(processing.callerFailed()).toBe(false);
  });
});

describe("a context that the loader returns", () => {
  it("is refused when it is no JSON, and the loader's call fails with it", async () => {
    const issuer = await createIssuer();
    await expect(
      addBaseProof(sampleCredential(), {
        signer: issuer.signer,
        contexts: async () => ({ "@context": { id: "@id", broken: () => 1 } }),
        created: CREATED,
      }),
    ).rejects.toThrow(/The context of .* from the context loader must be JSON, but .*broken is a function/);
  });

  it("is copied, so that the processors rewrite a copy and not the caller's context", async () => {
    const issuer = await createIssuer();
    const context = { "@context": { "@vocab": "https://example.test/vocab#", id: "@id", type: "@type" } };
    const before = structuredClone(context);
    await addBaseProof(sampleCredential(), { signer: issuer.signer, contexts: async () => context, created: CREATED });
    expect(context).toStrictEqual(before);
  });
});
