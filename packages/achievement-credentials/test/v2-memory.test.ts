import { describe, expect, it } from "vitest";
import { soundAssertion } from "../../../scripts/open-badges-v2-rules.js";
import { validateCredential } from "../src/index.js";

const MIB = 1024 * 1024;
/** The bytes that a reading may raise the peak of the process by. Unbounded, the input below took 1 GB; bounded, 90 MiB. */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a hostile Open Badges 2.0 assertion", () => {
  it("stays within the budget for a list of a million wrong values, whose findings stop at the limit", () => {
    const tags = new Array(1_000_000).fill(0);
    const value = { ...soundAssertion(), badge: { ...(soundAssertion().badge as object), tags } };
    const before = peak();
    expect(validateCredential(value)).toHaveLength(1001);
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
