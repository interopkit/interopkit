import { describe, expect, it } from "vitest";
import { verifyCredential } from "../src/verify/index.js";
import { clrCredential } from "./fixtures.js";
import { world } from "./status-fixtures.js";
import { badge, jwsOf } from "./verify-fixtures.js";

const MIB = 1024 * 1024;
/**
 * The bytes that one verification may raise the peak of the process by. The CLR below holds 600 credentials that each name a
 * refresh service answering a credential of 600,000 characters, which the service signs when it is asked: refreshing every
 * one raised the peak by 174 to 218 MiB on Node.js 22 and by 246 to 264 MiB on Node.js 24, and the bound of 16 refreshes by 47
 * to 60 MiB and 73 to 89 MiB. The signing of the services falls in the measure, and the young generation of Node.js 24 holds
 * more before it is collected, so the bounded peak is far above the bytes that the 16 answers take.
 */
const BUDGET = 128 * MIB;
/** The characters of the name of each refreshed credential, which a JWS of less than the 1 MiB that a fetch reads holds. */
const NAME_CHARACTERS = 600_000;
/** The credentials that the CLR holds. */
const HELD = 600;

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
      return new Response(await jwsOf(refreshing(Number(index), "x".repeat(NAME_CHARACTERS))), { status: 200 });
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
