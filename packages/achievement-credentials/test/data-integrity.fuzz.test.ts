import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createContextLoader, validateJsonLd, verifyProof } from "../src/data-integrity/index.js";
import type { IssuableCredential } from "../src/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { memoryContexts } from "./context-fixtures.js";
import { achievementCredential } from "./fixtures.js";
import { clockAt, serve } from "./key-fixtures.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_106, numRuns: 150 };

const clock = clockAt(Date.UTC(2024, 5, 14));
const contexts = memoryContexts();
const read = { keys: createKeyResolver({ clock }), clock, contexts: contexts.load };

/** A proof of any shape, built from the properties that a verifier reads. */
const proofs = fc.oneof(
  fc.jsonValue({ maxDepth: 3 }),
  fc.record(
    {
      type: fc.constantFrom("DataIntegrityProof", "Ed25519Signature2020", "x"),
      cryptosuite: fc.constantFrom("eddsa-rdfc-2022", "ecdsa-rdfc-2019", "ecdsa-sd-2023", "x"),
      proofPurpose: fc.constantFrom("assertionMethod", "authentication"),
      verificationMethod: fc.oneof(fc.constant("did:key:z6Mknotakey"), fc.string({ maxLength: 40 })),
      proofValue: fc.string({ maxLength: 120 }),
      created: fc.string({ maxLength: 30 }),
      expires: fc.string({ maxLength: 30 }),
    },
    { requiredKeys: [] },
  ),
);

describe("verifyProof", () => {
  it("returns a verdict for a credential with any proof, and never throws", async () => {
    await fc.assert(
      fc.asyncProperty(proofs, async (proof) => {
        const credential = { ...achievementCredential(), proof } as unknown as IssuableCredential;
        const result = await verifyProof(credential, { ...read, legacyProofs: true });
        expect(result.valid).toBe(false);
      }),
      RUNS,
    );
  });

  it("returns a verdict for any JSON in place of a credential", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue({ maxDepth: 4 }), async (value) => {
        if (value === null || typeof value !== "object" || Array.isArray(value)) return;
        expect((await verifyProof(value as unknown as IssuableCredential, read)).valid).toBe(false);
      }),
      RUNS,
    );
  });
});

describe("validateJsonLd", () => {
  it("lists at most 100 findings for any properties, and never throws", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string({ maxLength: 12 }), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 30 }),
        async (extra) => {
          const { __proto__: _ignored, ...safe } = extra as Record<string, unknown>;
          const credential = { ...achievementCredential(), ...safe, "@context": achievementCredential()["@context"] };
          const issues = await validateJsonLd(credential as unknown as IssuableCredential, { contexts: contexts.load });
          expect(issues.length).toBeLessThanOrEqual(100);
        },
      ),
      RUNS,
    );
  });
});

describe("the loader of contexts", () => {
  it("serves nothing for an address that it has no pin for, whatever the address", async () => {
    const { fetch, requests } = serve({});
    const load = createContextLoader({ fetch });
    await fc.assert(
      fc.asyncProperty(fc.webUrl({ validSchemes: ["https"] }), async (url) => {
        await expect(load(url)).rejects.toThrow("has no pin");
      }),
      RUNS,
    );
    expect(requests).toStrictEqual([]);
  });
});
