import { describe, expect, it } from "vitest";
import { AU1, testHost } from "./lms-host.js";
import { launchUnit, register } from "./lms-session.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the reading may raise the peak by: the body is the host's, and the LMS reads none of it beyond its limit. */
const BUDGET = 32 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of a preferences document of 10 MiB that a unit writes", () => {
  it("stays within the budget, and refuses the document after its limit of 4,096 bytes", async ({ annotate }) => {
    const host = testHost();
    const launched = await launchUnit(host, { registration: (await register(host)).id, au: AU1 });
    const body = new Uint8Array(10 * MIB - 1024).fill(0x20);
    const path = `agents/profile?${new URLSearchParams({ profileId: "cmi5LearnerPreferences", agent: JSON.stringify(launched.actor) })}`;
    const before = peak();
    const answer = await host.xapi("PUT", path, {
      authorization: launched.authorization,
      body,
      headers: { "content-type": "application/json" },
    });
    const rise = peak() - before;
    expect(answer.status).toBe(403);
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
