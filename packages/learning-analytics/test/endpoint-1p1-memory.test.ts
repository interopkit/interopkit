import { describe, expect, it } from "vitest";
import { handleCaliperRequest } from "../src/endpoint/index.js";
import { CALIPER_1_1_CONTEXT } from "../src/index.js";
import { envelopeOf, post, recorder } from "./endpoint-fixture.js";
import { STARTED_DOCUMENT } from "./fixture.js";

const MIB = 1024 * 1024;
/** The bytes that a request may raise the peak of the process by. An answer that kept the parse and the findings of many copies would take far more. */
const BUDGET = 256 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

const { profile: _profile, ...WITHOUT_PROFILE } = STARTED_DOCUMENT;

/** The event of Caliper 1.1 at the index. */
const eventAt = (index: number) => ({
  ...WITHOUT_PROFILE,
  "@context": CALIPER_1_1_CONTEXT,
  id: `urn:uuid:3a648e68-f00d-4c08-aa59-${String(index).padStart(12, "0")}`,
});

/** The most events of Caliper 1.1 that an envelope of at most 1 MiB holds. */
function fullEnvelope(): Record<string, unknown> {
  let count = Math.floor(MIB / (JSON.stringify(eventAt(0)).length + 1));
  for (;;) {
    const envelope = envelopeOf(
      Array.from({ length: count }, (_, at) => eventAt(at)),
      {
        dataVersion: CALIPER_1_1_CONTEXT,
      },
    );
    if (JSON.stringify(envelope).length <= MIB) return envelope;
    count -= 1;
  }
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures one request.
describe("the peak memory of receiving an envelope of Caliper 1.1 with 1 MiB of events", () => {
  it("stays within the budget, and hands every event to accept", async ({ annotate }) => {
    const request = post(fullEnvelope());
    const endpoint = recorder();
    const before = peak();
    const response = await handleCaliperRequest(request, endpoint.options);
    expect(response.status).toBe(200);
    expect(endpoint.received[0]?.dataVersion).toBe(CALIPER_1_1_CONTEXT);
    expect(endpoint.received[0]?.data.length).toBeGreaterThan(1_000);
    expect(endpoint.received[0]?.findings).toStrictEqual([]);
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
