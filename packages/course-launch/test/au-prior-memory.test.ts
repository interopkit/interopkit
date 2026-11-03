import { describe, expect, it } from "vitest";
import { startAuSession } from "../src/au/index.js";
import { launchFor } from "./au-host.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the reading may raise the peak by: an answer of 1 MiB to a query of one statement, read by the client. */
const BUDGET = 64 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading what the registration held, with an answer at the limit of the runtime", () => {
  it("stays within the budget, and refuses an answer larger than the limit", async ({ annotate }) => {
    const launch = await launchFor();
    const answer = JSON.stringify({ statements: [], more: "", pad: "x".repeat(MIB + 1) });
    const before = peak();
    await expect(
      startAuSession(launch.url, {
        fetch: async (url, init) =>
          url.includes("/statements?")
            ? new Response(answer, { headers: { "content-type": "application/json" } })
            : launch.fetch(url, init),
      }),
    ).rejects.toThrow();
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
