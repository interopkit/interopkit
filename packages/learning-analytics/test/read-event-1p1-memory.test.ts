import { describe, expect, it } from "vitest";
import { CALIPER_1_1_CONTEXT, validateEvent } from "../src/index.js";
import { STARTED_DOCUMENT } from "./fixture.js";

const MIB = 1024 * 1024;
/** The bytes that a check may raise the peak of the process by. A check that kept an issue for each wrong value would take about 1 GB. */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one check.
describe("the peak memory of judging a hostile event of Caliper 1.1", () => {
  it("stays within the budget for an object that holds a list of a million wrong values", async ({ annotate }) => {
    const items = new Array(1_000_000).fill(0);
    const { profile: _profile, ...rest } = STARTED_DOCUMENT;
    const value = {
      ...rest,
      "@context": CALIPER_1_1_CONTEXT,
      object: { id: "https://exam.example/tests/42", type: "Assessment", items },
    };
    const before = peak();
    const findings = validateEvent(value, { version: "1.1" });
    expect(findings).toHaveLength(1_001);
    expect(findings.at(-1)?.rule).toBe("findings-stopped");
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
