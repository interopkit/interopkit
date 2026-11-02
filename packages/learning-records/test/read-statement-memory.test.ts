import { describe, expect, it } from "vitest";
import { validateStatements } from "../src/index.js";
import { minimalStatement } from "./full-statement.js";

const MIB = 1024 * 1024;
/** The bytes that the judgment may raise the peak of the process by. A judgment that kept a finding for each wrong value would take about 1 GB. */
const BUDGET = 64 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one judgment.
describe("the peak memory of judging a batch whose Statement has a million wrong Activities", () => {
  it("stays within the budget, and lists the findings of the limit and one that says it stopped", async ({
    annotate,
  }) => {
    const statement = {
      ...minimalStatement(),
      context: { contextActivities: { parent: new Array(1_000_000).fill(0) } },
    };
    const before = peak();
    const findings = validateStatements([statement]);
    const rise = peak() - before;
    expect(findings).toHaveLength(1_001);
    expect(findings.at(-1)?.rule).toBe("findings-stopped");
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
