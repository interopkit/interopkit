import { describe, expect, it } from "vitest";
import { addProof, verifyProof } from "../src/data-integrity/index.js";
import type { IssuableCredential } from "../src/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { memoryContexts } from "./context-fixtures.js";
import { achievementCredential } from "./fixtures.js";
import { clockAt, KEYS, signerOf } from "./key-fixtures.js";

const MIB = 1024 * 1024;
/** The bytes that a verification may raise the peak of the process by. Unbounded, the credential below took 800 MiB; bounded, 80. */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one verification.
describe("the peak memory of verifying a credential built to exhaust the canonicalization", () => {
  it("stays within the budget for a list of 5,000 alike items, which is refused as a limit", async () => {
    const clock = clockAt(Date.UTC(2024, 5, 14, 12, 0, 0));
    const contexts = memoryContexts();
    const did = `did:key:${KEYS.ed25519.multikey}`;
    const honest = await addProof(
      { ...achievementCredential(), issuer: { id: did, type: ["Profile"] } } as unknown as IssuableCredential,
      signerOf(KEYS.ed25519, `${did}#${KEYS.ed25519.multikey}`),
      { clock, contexts: contexts.load },
    );
    const hostile = {
      ...honest,
      extra: { "@list": Array.from({ length: 5000 }, () => 1) },
    } as unknown as IssuableCredential;
    const before = peak();
    const verdict = await verifyProof(hostile, { keys: createKeyResolver({ clock }), clock, contexts: contexts.load });
    expect(verdict).toMatchObject({ valid: false });
    expect(JSON.stringify(verdict)).toContain("1000 runs of the Hash N-Degree Quads algorithm");
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
