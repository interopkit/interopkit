import { describe, expect, it } from "vitest";
import { verifyStatementSignature } from "../src/signing/index.js";
import { minimalStatement } from "./full-statement.js";

const MIB = 1024 * 1024;
/**
 * The bytes that the verification may raise the peak of the process by: the JWS, its payload, the parse and the copy that the
 * reader makes. It rises by 100 to 140 MiB on a quiet machine and up to 194 MiB when other test runs starve the collector.
 */
const BUDGET = 256 * MIB;

/** The names of the extension of the payload: with the rest of the Statement, near the million tokens that the reader takes. */
const NAMES = 249_900;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

const base64url = (text: string) => Buffer.from(text).toString("base64url");

// Each test file runs in a process of its own, and the peak only grows, so this file measures one verification.
describe("the peak memory of verifying a signature", () => {
  it("reads the payload of the most tokens that the reader takes, the worst for memory, within the budget", async ({
    annotate,
  }) => {
    const statement = minimalStatement();
    const extensions = `{${Array.from({ length: NAMES }, (_, index) => `"https://example.org/k${index}":0`).join(",")}}`;
    const payload = JSON.stringify({
      ...statement,
      object: { ...statement.object, definition: { extensions: {} } },
    }).replace('"extensions":{}', `"extensions":${extensions}`);
    const jws = `${base64url('{"alg":"RS256"}')}.${base64url(payload)}.${base64url("signature")}`;
    const signature = new TextEncoder().encode(jws);
    const before = peak();
    // No key and no chain: the payload is read and compared, and the verdict is that no key verifies it.
    expect(await verifyStatementSignature(statement, signature)).toStrictEqual({ valid: false, reason: "no-key" });
    const rise = peak() - before;
    await annotate(`The JWS has ${signature.byteLength} bytes; the peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
