import { describe, expect, it } from "vitest";
import { handleCaliperRequest } from "../src/endpoint/index.js";
import { envelopeOf, post, recorder, soundAt } from "./endpoint-fixture.js";

const MIB = 1024 * 1024;
/** The bytes that a request may raise the peak of the process by. An answer that kept the parse and the findings of many copies would take far more. */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** The most events that an envelope of at most 1 MiB holds. */
function fullEnvelope(): Record<string, unknown> {
  const one = JSON.stringify(soundAt(0)).length + 1;
  let count = Math.floor(MIB / one);
  for (;;) {
    const envelope = envelopeOf(Array.from({ length: count }, (_, at) => soundAt(at)));
    if (JSON.stringify(envelope).length <= MIB) return envelope;
    count -= 1;
  }
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures one request.
describe("the peak memory of receiving an envelope of 1 MiB of events", () => {
  it("stays within the budget, and hands every event to accept", async ({ annotate }) => {
    const envelope = fullEnvelope();
    const request = post(envelope);
    const endpoint = recorder();
    const before = peak();
    const response = await handleCaliperRequest(request, endpoint.options);
    expect(response.status).toBe(200);
    expect(endpoint.received[0]?.data.length).toBeGreaterThan(1_000);
    expect(endpoint.received[0]?.findings).toStrictEqual([]);
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
