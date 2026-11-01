import { describe, expect, it } from "vitest";
import { addBaseProof, deriveProof, selectiveDisclosureSuite } from "../src/index.js";
import { createSharedIssuer, dbVerify } from "./digital-bazaar.js";
import { downloadedContexts } from "./downloads.js";
import { vcCredential } from "./vc-credential.js";

/** How much longer than Digital Bazaar's suite `verify` may take, as a ratio of the medians. */
const BUDGET = 1.25;
/** Verifications of each suite that are timed, after the warm-up. */
const TIMED_RUNS = 30;
const WARM_UP_RUNS = 5;

const CONTEXTS = downloadedContexts();
const contexts = async (url: string) => structuredClone(CONTEXTS.get(url));

/** The median of a list of times. */
function median(times: readonly number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe("the speed of the verification", () => {
  it("is at parity with Digital Bazaar's suite or better, on a disclosure of 8 of 12 achievements", async () => {
    const issuer = await createSharedIssuer();
    const base = await addBaseProof(vcCredential(12), {
      signer: issuer.signer,
      mandatoryPointers: ["/issuer"],
      contexts,
      created: "2026-11-01T09:30:00Z",
    });
    const disclosure = await deriveProof(base, {
      selectivePointers: Array.from({ length: 8 }, (_, index) => `/credentialSubject/achievements/${index}`),
      contexts,
    });
    const { proof, ...document } = disclosure;
    const ours = () =>
      selectiveDisclosureSuite.verify(document, proof as Record<string, unknown>, {
        publicKeyJwk: issuer.publicKeyJwk,
        contexts,
      });
    const theirs = () => dbVerify(disclosure, issuer);

    for (let run = 0; run < WARM_UP_RUNS; run += 1) expect([await ours(), await theirs()]).toStrictEqual([true, true]);
    // The two take turns, so that a host that slows down during the run slows both.
    const timesOurs: number[] = [];
    const timesTheirs: number[] = [];
    for (let run = 0; run < TIMED_RUNS; run += 1) {
      let start = performance.now();
      await ours();
      timesOurs.push(performance.now() - start);
      start = performance.now();
      await theirs();
      timesTheirs.push(performance.now() - start);
    }
    expect(median(timesOurs) / median(timesTheirs)).toBeLessThan(BUDGET);
  });
});
