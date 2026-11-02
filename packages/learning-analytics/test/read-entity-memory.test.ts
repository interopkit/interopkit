import { describe, expect, it } from "vitest";
import { CALIPER_CONTEXT, readEntity } from "../src/index.js";

const MIB = 1024 * 1024;
/** The bytes that a reading may raise the peak of the process by. A reading that kept an issue for each wrong value would take about 1 GB. */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a hostile entity", () => {
  it("stays within the budget for a list of a million wrong values, which the reader refuses at the first", async ({
    annotate,
  }) => {
    const members = new Array(1_000_000).fill(0);
    const value = { "@context": CALIPER_CONTEXT, id: "https://example.edu/sections/1", type: "CourseSection", members };
    const before = peak();
    expect(() => readEntity(value)).toThrow("The entity is invalid at members[0]");
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
