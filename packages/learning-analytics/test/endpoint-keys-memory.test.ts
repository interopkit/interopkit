import { describe, expect, it } from "vitest";
import { handleCaliperRequest } from "../src/endpoint/index.js";
import { envelopeOf, recorder, request, soundAt } from "./endpoint-fixture.js";

const MIB = 1024 * 1024;
/** The bytes that a request may raise the peak of the process by, as for the other readings of the endpoint. */
const BUDGET = 256 * MIB;

/** The most bytes of a body that the endpoint takes unless it is told another. */
const MAX_PAYLOAD_BYTES = 1_048_576;

/** The characters of each key: short keys put the most members, which cost the most memory for their bytes, in the body. */
const KEY_LENGTH = 14;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** The text of an envelope whose one event has extensions of as many distinct keys as the default limit of bytes takes. */
function widestEnvelope(): string {
  const text = JSON.stringify(envelopeOf([{ ...soundAt(0), extensions: {} }]));
  const [head, tail] = text.split('"extensions":{}');
  let members = "";
  for (
    let index = 0;
    `${head}"extensions":{${members}}${tail}`.length + KEY_LENGTH + 5 <= MAX_PAYLOAD_BYTES;
    index += 1
  ) {
    members += `${index === 0 ? "" : ","}"${String(index).padStart(KEY_LENGTH, "k")}":0`;
  }
  return `${head}"extensions":{${members}}${tail}`;
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures one request.
describe("the peak memory of receiving an event whose extensions have as many distinct keys as 1 MiB holds", () => {
  it("stays within the budget, and hands the event to accept", async ({ annotate }) => {
    const text = widestEnvelope();
    const endpoint = recorder();
    const before = peak();
    const response = await handleCaliperRequest(request(text), endpoint.options);
    const rise = peak() - before;
    expect(response.status).toBe(200);
    expect(endpoint.received[0]?.data).toHaveLength(1);
    await annotate(`The body has ${text.length} bytes; the peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
