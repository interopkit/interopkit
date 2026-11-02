import { describe, expect, it } from "vitest";
import { verifyCredential } from "../src/verify/index.js";
import { world } from "./status-fixtures.js";
import { badge, jwsOf } from "./verify-fixtures.js";

const MIB = 1024 * 1024;
/**
 * The bytes that one verification may raise the peak of the process by. The JWS below is at the limit of its size and holds
 * as many numbers as the limit leaves room for, which the reader parses; a JWS ten times its size, which the limit refuses
 * by its length, would take about ten times as much.
 */
const BUDGET = 96 * MIB;
/** The most characters of a JWS, `maxInputBytes`. */
const LIMIT = 1_048_576;
/** The characters of base64url for each byte of the payload. */
const CHARACTERS_PER_BYTE = 4 / 3;
/** The bytes of a number of one digit and its comma. */
const BYTES_PER_NUMBER = 2;
/** Room left for the header and the signature of the JWS. */
const FRAME_CHARACTERS = 1024;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one verification.
describe("the peak memory of a verification of a JWS at its size limit", () => {
  it("stays within the budget for a payload that holds the most numbers that the limit leaves room for", async () => {
    const shell = JSON.stringify({ ...badge(), extra: [] });
    const count = Math.floor(((LIMIT - FRAME_CHARACTERS) / CHARACTERS_PER_BYTE - shell.length) / BYTES_PER_NUMBER);
    const jws = await jwsOf({ ...badge(), extra: new Array(count).fill(0) });
    expect(jws.length).toBeLessThanOrEqual(LIMIT);
    const { options } = world();
    const before = peak();
    const result = await verifyCredential(jws, options);
    const grown = peak() - before;
    expect(result.verified).toBe(true);
    expect(grown).toBeLessThan(BUDGET);
  });
});
