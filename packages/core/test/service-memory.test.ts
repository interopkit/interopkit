import { describe, expect, it } from "vitest";
import { requestService, ServiceError } from "../src/index.js";

const MIB = 1024 * 1024;
/**
 * The bytes that one call may raise the peak of the process by. The service below answers without end, in chunks of 64 KiB;
 * the call reads 1 MiB, its limit here, and cancels the rest, where a reading to the end would never stop.
 */
const BUDGET = 32 * MIB;
/** The limit of the call, and the chunks of the answer. */
const LIMIT = MIB;
const CHUNK_BYTES = 65_536;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one call.
describe("the peak memory of a call to a service that answers without end", () => {
  it("stays within the budget, reads no more than the limit and cancels the rest of the answer", async () => {
    let sent = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += CHUNK_BYTES;
        controller.enqueue(new Uint8Array(CHUNK_BYTES).fill(0x61));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetch = async () => new Response(endless, { status: 200 });
    const before = peak();
    const call = requestService(
      { fetch, timeoutMs: 60_000 },
      "The service",
      "https://service.example/",
      { method: "GET", headers: {} },
      { maxBytes: LIMIT },
    );
    await expect(call).rejects.toBeInstanceOf(ServiceError);
    const grown = peak() - before;
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThanOrEqual(LIMIT + 2 * CHUNK_BYTES);
    expect(grown).toBeLessThan(BUDGET);
  });
});
