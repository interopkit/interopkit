import { describe, expect, it } from "vitest";
import { attachmentHash, readMultipart } from "../src/attachments/index.js";

const MIB = 1024 * 1024;
/** The bytes that the reading may raise the peak of the process by: the parts of a message of 10 MiB are 10 MiB, and a copy. */
const BUDGET = 64 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** A message of the Statements and 99 parts, 10 MiB in all, the most that the default limits take. */
function largestMessage(): Uint8Array {
  const encoder = new TextEncoder();
  const size = Math.floor((10 * MIB - 40_000) / 99);
  const chunks: Uint8Array[] = [encoder.encode("--b\r\nContent-Type: application/json\r\n\r\n{}\r\n")];
  for (let index = 0; index < 99; index += 1) {
    const data = new Uint8Array(size).fill(index + 1);
    chunks.push(
      encoder.encode(`--b\r\nX-Experience-API-Hash: ${attachmentHash(data)}\r\n\r\n`),
      data,
      encoder.encode("\r\n"),
    );
  }
  chunks.push(encoder.encode("--b--\r\n"));
  const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a multipart message", () => {
  it("reads the most parts and bytes that the limits take, within the budget", async ({ annotate }) => {
    const body = largestMessage();
    const before = peak();
    expect(readMultipart("multipart/mixed; boundary=b", body).parts.size).toBe(99);
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
