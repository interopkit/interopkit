import { describe, expect, it } from "vitest";
import { readEvent } from "../src/index.js";
import { STARTED_DOCUMENT } from "./fixture.js";

const MIB = 1024 * 1024;
/** The bytes that a reading may raise the peak of the process by. A reading that kept an issue for each wrong value would take about 1 GB. */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a hostile event", () => {
  it("stays within the budget for an object that holds a list of a million wrong values", () => {
    const items = new Array(1_000_000).fill(0);
    const value = { ...STARTED_DOCUMENT, object: { id: "https://exam.example/tests/42", type: "Assessment", items } };
    const before = peak();
    expect(() => readEvent(value)).toThrow("The event is invalid at object.items[0]");
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
