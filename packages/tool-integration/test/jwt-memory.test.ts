import { base64url } from "jose";
import { describe, expect, it } from "vitest";
import { unverifiedClaims } from "../src/protocol/internal.js";

const MIB = 1024 * 1024;
/** The bytes that a refusal may raise the peak of the process by. Parsed, the payload below takes about 200 MiB. */
const BUDGET = 64 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading the claims of a token before its signature is verified", () => {
  it("refuses a payload of more than a million JSON tokens by their number, within the budget, without parsing it", () => {
    // 1.2 million empty objects: 3.6 million tokens in 3.6 MB, which a parser turns into an object each.
    const payload = `[${"{},".repeat(1_200_000)}{}]`;
    const token = `${base64url.encode('{"alg":"RS256"}')}.${base64url.encode(payload)}.${base64url.encode("signature")}`;
    const before = peak();
    expect(() => unverifiedClaims(token)).toThrow(expect.objectContaining({ reason: "token-malformed" }));
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
