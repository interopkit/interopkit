import { describe, expect, it } from "vitest";
import { readJwsPayload } from "../src/read/internal.js";

const MIB = 1024 * 1024;
/** The bytes that a refusal may raise the peak of the process by. Parsed, the payload below took 354 MiB; refused, 44 MiB. */
const BUDGET = 128 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading the payload of a hostile JWS", () => {
  it("refuses a payload of four million empty arrays by its tokens, within the budget, without parsing it", () => {
    const payload = `{"a":[${"[],".repeat(4_000_000)}[]]}`;
    const jws = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(payload).toString("base64url")}.c2ln`;
    const before = peak();
    expect(readJwsPayload(jws, 1_000_000)).toStrictEqual({
      reason: "The payload of the JWS has more than the 1000000 tokens of JSON that it may have.",
    });
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
