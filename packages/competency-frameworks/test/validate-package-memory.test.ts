import { describe, expect, it } from "vitest";
import { validatePackage } from "../src/index.js";
import { id, uri } from "./full-package.js";

const MIB = 1024 * 1024;
/** The bytes that the judgment may raise the peak of the process by. A judgment that kept a finding for each wrong value would take about 1 GB. */
const BUDGET = 64 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one judgment.
describe("the peak memory of judging a package with a million wrong items", () => {
  it("stays within the budget, and lists the findings of the limit and one that says it stopped", async ({
    annotate,
  }) => {
    const document = {
      identifier: id(1),
      uri: uri("CFDocuments", 1),
      creator: "Ministry of Education",
      title: "A framework",
      lastChangeDateTime: "2024-06-13T18:46:03+00:00",
    };
    const value = { CFDocument: document, CFItems: new Array(1_000_000).fill(0) };
    const before = peak();
    const findings = validatePackage(value);
    expect(findings).toHaveLength(1_001);
    expect(findings.at(-1)?.rule).toBe("findings-stopped");
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
