import { describe, expect, it } from "vitest";
import { AU1, testHost } from "./lms-host.js";
import { launchUnit, register, sendStatement, unitStatement } from "./lms-session.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the judgement may raise the peak by, for a batch at the limits of the LRS. */
const BUDGET = 256 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of judging a batch of 1,000 statements of a unit, near 10 MiB", () => {
  it("stays within the budget, and takes the batch", async ({ annotate }) => {
    const host = testHost();
    const launched = await launchUnit(host, { registration: (await register(host)).id, au: AU1 });
    await sendStatement(host, launched, unitStatement(launched, "initialized"));
    const pad = "x".repeat(9000);
    const batch = Array.from({ length: 1000 }, () => ({
      ...unitStatement(launched, "experienced"),
      result: { response: pad },
    }));
    expect(JSON.stringify(batch).length).toBeLessThan(10 * MIB);
    const before = peak();
    const answer = await host.xapi("POST", "statements", { authorization: launched.authorization, body: batch });
    const rise = peak() - before;
    expect(answer.status).toBe(200);
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
