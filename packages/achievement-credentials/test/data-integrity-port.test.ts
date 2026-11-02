import * as selectiveDisclosure from "@interopkit/selective-disclosure";
import { describe, expect, it, vi } from "vitest";
import { addProof, deriveDisclosure, verifyProof } from "../src/data-integrity/index.js";
import type { IssuableCredential } from "../src/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { memoryContexts } from "./context-fixtures.js";
import { achievementCredential } from "./fixtures.js";
import { clockAt, KEYS, signerOf } from "./key-fixtures.js";

// The functions of selective-disclosure that the glue calls, wrapped so that the options they are given can be read.
vi.mock("@interopkit/selective-disclosure", async (importOriginal) => {
  const original = await importOriginal<typeof import("@interopkit/selective-disclosure")>();
  return {
    ...original,
    addBaseProof: vi.fn(original.addBaseProof),
    deriveProof: vi.fn(original.deriveProof),
    selectiveDisclosureSuite: {
      ...original.selectiveDisclosureSuite,
      verify: vi.fn(original.selectiveDisclosureSuite.verify),
    },
  };
});

const did = `did:key:${KEYS.es256.multikey}`;
const method = `${did}#${KEYS.es256.multikey}`;

describe("the options that the glue gives to selective-disclosure", () => {
  it("hold the limit of tokens of the host in all three roles, and not the default of the package", async () => {
    const clock = clockAt(Date.UTC(2024, 5, 14, 12, 0, 0));
    const contexts = memoryContexts();
    const credential = {
      ...achievementCredential(),
      issuer: { id: did, type: ["Profile"] },
    } as unknown as IssuableCredential;
    const base = await addProof(credential, signerOf(KEYS.es256, method), {
      clock,
      contexts: contexts.load,
      cryptosuite: "ecdsa-sd-2023",
      maxJsonLdTokens: 4000,
    });
    expect(vi.mocked(selectiveDisclosure.addBaseProof).mock.calls[0]?.[1]).toMatchObject({ maxTokens: 4000 });
    const disclosure = await deriveDisclosure(base, {
      selectivePointers: [],
      contexts: contexts.load,
      maxJsonLdTokens: 3000,
    });
    expect(vi.mocked(selectiveDisclosure.deriveProof).mock.calls[0]?.[1]).toMatchObject({ maxTokens: 3000 });
    const result = await verifyProof(disclosure, {
      keys: createKeyResolver({ clock }),
      clock,
      contexts: contexts.load,
      maxInputBytes: 90_000,
      maxJsonLdTokens: 2000,
    });
    expect(result.valid).toBe(true);
    const [document, , options] = vi.mocked(selectiveDisclosure.selectiveDisclosureSuite.verify).mock.calls[0] ?? [];
    expect(options).toMatchObject({ maxBytes: 90_000, maxTokens: 2000 });
    expect(Reflect.has(Object(document), "proof")).toBe(false);
  });
});
