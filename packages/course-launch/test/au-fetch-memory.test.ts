import { ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { startAuSession } from "../src/au/index.js";
import { launchFor } from "./au-host.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the reading may raise the peak by. A runtime that parsed the answer first would hold every token of it. */
const BUDGET = 16 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading the answer of the fetch URL at its limit, with the most tokens it holds", () => {
  it("stays within the budget, and refuses the answer before it parses it", async ({ annotate }) => {
    const launch = await launchFor();
    const answer = `[${"0,".repeat(32_766)}0]`;
    const before = peak();
    await expect(
      startAuSession(launch.url, {
        fetch: async (url, init) => (url.includes("/fetch") ? new Response(answer) : launch.fetch(url, init)),
      }),
    ).rejects.toThrow(ServiceError);
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
