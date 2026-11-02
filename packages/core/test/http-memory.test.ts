import { describe, expect, it } from "vitest";
import { readJson } from "../src/http/index.js";

const MIB = 1024 * 1024;
/**
 * The bytes that one reading may raise the peak of the process by. The body below is at the default size limit and holds as
 * many empty objects as the default limit of tokens leaves room for, each of which the parser builds; a body ten times its
 * size, which the limits refuse, would take about ten times as much.
 */
const BUDGET = 96 * MIB;
/** The default limits of `readJson`: its bytes and its tokens. */
const LIMIT = 1_048_576;
const TOKENS = 1_000_000;
/** The tokens of an empty object in a list: its two braces and a comma. */
const TOKENS_PER_OBJECT = 3;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a hostile JSON body", () => {
  it("stays within the budget for a body at the size limit that holds the most objects that the tokens allow", () => {
    const count = Math.floor((TOKENS - 2) / TOKENS_PER_OBJECT);
    const body = new TextEncoder().encode(`[${new Array(count).fill("{}").join(",")}]`);
    expect(body.byteLength).toBeLessThanOrEqual(LIMIT);
    const before = peak();
    const read = readJson({ method: "POST", url: "https://provider.example/", headers: {}, body });
    const grown = peak() - before;
    expect(read).toHaveLength(count);
    expect(grown).toBeLessThan(BUDGET);
  });
});
