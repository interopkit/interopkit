import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { addBaseProof, deriveProof, selectiveDisclosureSuite } from "../src/index.js";
import { memoryContexts } from "./contexts.js";
import { CREATED, sampleCredential } from "./documents.js";
import { createIssuer, type Issuer } from "./keys.js";
import { type Disclosure, disclosure, type Signed, signedCredential } from "./setup.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. Each run canonicalizes a document. */
const RUNS = { seed: 20_261_101, numRuns: 300 };
const STRINGS = [...BAD_STRINGS, "/issuer", "ecdsa-sd-2023", "DataIntegrityProof"];

/** Serves the contexts of the tests, and an empty context for any other URL, as a loader that has no pin for it would not. */
const contexts = {
  load: async (url: string): Promise<unknown> => {
    try {
      return await memoryContexts().load(url);
    } catch {
      return { "@context": {} };
    }
  },
};

/** Values of every kind that JSON or JavaScript can hand over, including those that JSON cannot write. */
const anything = fc.oneof(
  fc.jsonValue(),
  fc.anything({
    withNullPrototype: true,
    withBigInt: true,
    withDate: true,
    withMap: true,
    withSet: true,
    withTypedArray: true,
  }),
);

let issuer: Issuer;
let signed: Signed;
let shown: Disclosure;

beforeAll(async () => {
  issuer = await createIssuer();
  signed = await signedCredential();
  shown = await disclosure();
});

describe("the base proof on any document", () => {
  it("is added or refused with a DataError, for a document with one change", async () => {
    await fc.assert(
      fc.asyncProperty(mutations, async (mutation) => {
        const document = mutate(sampleCredential(), mutation, STRINGS) as Record<string, unknown>;
        try {
          const result = await addBaseProof(document, {
            signer: issuer.signer,
            contexts: contexts.load,
            created: CREATED,
          });
          expect(result.proof).toBeDefined();
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
      RUNS,
    );
  });

  it("is added or refused with a DataError, for a value of any kind", async () => {
    await fc.assert(
      fc.asyncProperty(anything, async (value) => {
        try {
          await addBaseProof(value as never, { signer: issuer.signer, contexts: contexts.load, created: CREATED });
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
      { ...RUNS, numRuns: 500 },
    );
  });
});

describe("the derived proof on any document and any pointers", () => {
  it("is derived or refused with a DataError, for a base proof with one change", async () => {
    await fc.assert(
      fc.asyncProperty(mutations, async (mutation) => {
        const document = mutate(signed.base, mutation, STRINGS) as Record<string, unknown>;
        try {
          const result = await deriveProof(document, {
            selectivePointers: ["/credentialSubject/name"],
            contexts: contexts.load,
          });
          expect(result.proof).toBeDefined();
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
      RUNS,
    );
  });

  it("is derived or refused with a DataError, for any text as a pointer", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string(), fc.constantFrom(...STRINGS), anything), async (pointer) => {
        try {
          const result = await deriveProof(signed.base, {
            selectivePointers: [pointer as string],
            contexts: contexts.load,
          });
          expect(result.proof).toBeDefined();
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
      { ...RUNS, numRuns: 500 },
    );
  });
});

describe("the verification on any disclosure", () => {
  it("rejects a disclosure with one change, and does not throw", async () => {
    await fc.assert(
      fc.asyncProperty(mutations, async (mutation) => {
        const document = mutate(shown.document, mutation, STRINGS) as Record<string, unknown>;
        const verdict = await selectiveDisclosureSuite.verify(document, shown.proof, {
          publicKeyJwk: shown.issuer.publicKeyJwk,
          contexts: contexts.load,
        });
        expect(verdict).toBe(JSON.stringify(document) === JSON.stringify(shown.document));
      }),
      RUNS,
    );
  });

  it("rejects a proof with one change, and does not throw", async () => {
    await fc.assert(
      fc.asyncProperty(mutations, async (mutation) => {
        const proof = mutate(shown.proof, mutation, STRINGS) as Record<string, unknown>;
        const verdict = await selectiveDisclosureSuite.verify(shown.document, proof, {
          publicKeyJwk: shown.issuer.publicKeyJwk,
          contexts: contexts.load,
        });
        expect(verdict).toBe(JSON.stringify(proof) === JSON.stringify(shown.proof));
      }),
      RUNS,
    );
  });

  it("answers true or false for a document and a proof of any kind that are objects", async () => {
    await fc.assert(
      fc.asyncProperty(fc.object(), fc.object(), async (document, proof) => {
        const verdict = await selectiveDisclosureSuite.verify(document, proof, {
          publicKeyJwk: shown.issuer.publicKeyJwk,
          contexts: contexts.load,
        });
        expect(verdict).toBe(false);
      }),
      { ...RUNS, numRuns: 500 },
    );
  });
});
