import { describe, expect, it } from "vitest";
import { readBasicAuthorization } from "../src/store/index.js";

const MIB = 1024 * 1024;
/** The bytes that the reading may raise the peak of the process by. With an array of the characters of the header, it took 290 MiB. */
const BUDGET = 64 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a Basic header", () => {
  it("reads a header of 10 MiB within the budget", async ({ annotate }) => {
    // The base64 of "ABC" again and again: a header of no colon.
    const authorization = `Basic ${btoa("ABC").repeat(2_621_440)}`;
    const before = peak();
    expect(readBasicAuthorization({ headers: { authorization } })).toBeUndefined();
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
