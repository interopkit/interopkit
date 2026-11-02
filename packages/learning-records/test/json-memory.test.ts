import { describe, expect, it } from "vitest";
import { readStatementJson } from "../src/index.js";

const MIB = 1024 * 1024;
/** The bytes that the reading may raise the peak of the process by. A parser that built a syntax tree took 250 MiB on this text; the scan takes about 70. */
const BUDGET = 128 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading the text of a request", () => {
  it("reads a million tokens of distinct names, the most that the search for a repeat keeps, within the budget", async ({
    annotate,
  }) => {
    const text = `{${Array.from({ length: 249_999 }, (_, index) => `"k${index}":0`).join(",")}}`;
    const before = peak();
    expect(Object.keys(readStatementJson(text) as object)).toHaveLength(249_999);
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
