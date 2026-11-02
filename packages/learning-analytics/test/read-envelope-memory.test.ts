import { describe, expect, it } from "vitest";
import { readEnvelope } from "../src/endpoint/index.js";
import { envelopeOf } from "./endpoint-fixture.js";
import { STARTED_DOCUMENT } from "./fixture.js";

const MIB = 1024 * 1024;
/** The bytes that a reading may raise the peak of the process by. A reading that kept an issue for each wrong value would take about 1 GB. */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading an envelope with a million wrong values", () => {
  it("stays within the budget, and lists the findings of the limit and one that says it stopped", () => {
    const items = new Array(1_000_000).fill(0);
    const event = { ...STARTED_DOCUMENT, object: { id: "https://exam.example/tests/42", type: "Assessment", items } };
    const envelope = envelopeOf([event]);
    const before = peak();
    const read = readEnvelope(envelope, "tool-7");
    expect(read.data).toStrictEqual([]);
    expect(read.findings).toHaveLength(1_001);
    expect(read.findings.at(-1)?.rule).toBe("findings-stopped");
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
