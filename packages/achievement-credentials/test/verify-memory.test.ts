import { describe, expect, it } from "vitest";
import { verifyCredential } from "../src/verify/index.js";
import { clrCredential } from "./fixtures.js";
import { world } from "./status-fixtures.js";
import { badge, jwsOf } from "./verify-fixtures.js";

const MIB = 1024 * 1024;
/**
 * The bytes that one verification may raise the peak of the process by. The CLR below holds 300 credentials that each name a
 * refresh service answering a credential of 700,000 characters: refreshing every one keeps about 210 MiB in the result, and the
 * bound on refreshes keeps 16 of them.
 */
const BUDGET = 128 * MIB;
/** The credentials that the CLR holds. */
const HELD = 300;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one verification.
describe("the peak memory of a verification of a hostile CLR", () => {
  it("stays within the budget when every credential that it holds names a refresh service that answers a large credential", async () => {
    const refreshing = (index: number, name = "A badge") => ({
      ...badge(),
      id: `https://example.edu/credentials/${index}`,
      name,
      refreshService: { id: `https://example.edu/refresh/${index}`, type: "1EdTechCredentialRefresh" },
    });
    const indexes = Array.from({ length: HELD }, (_, index) => index);
    const held = await Promise.all(indexes.map((index) => jwsOf(refreshing(index))));
    const { options } = world();
    // Each service answers the newer version of its own credential, signed when it is asked for.
    const fetch: typeof options.fetch = async (url, init) => {
      const index = /\/refresh\/(\d+)$/u.exec(url)?.[1];
      if (index === undefined) return await options.fetch(url, init);
      return new Response(await jwsOf(refreshing(Number(index), "x".repeat(700_000))), { status: 200 });
    };
    const clr = await jwsOf({
      ...clrCredential(),
      credentialSubject: { ...(clrCredential().credentialSubject as object), verifiableCredential: held },
    });
    const before = peak();
    const result = await verifyCredential(clr, { ...options, fetch });
    const grown = peak() - before;
    expect(result.nested).toHaveLength(HELD);
    expect(grown).toBeLessThan(BUDGET);
  });
});
