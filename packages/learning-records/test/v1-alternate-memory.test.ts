import { describe, expect, it } from "vitest";
import { handleLrsRequest } from "../src/store/index.js";
import { memory, optionsOf, requestOf } from "./memory-lrs.js";

const MIB = 1024 * 1024;
/**
 * The bytes that a refusal may raise the peak of the process by. Read into a map, the form below took 244 to 448 MiB on Node.js 22
 * and 24; refused, less than 1 MiB.
 */
const BUDGET = 32 * MIB;

/** The distinct names of the form, each of four characters: `0000=&`, `0001=&`, and so on. */
const NAMES = 1_500_000;
/** The bytes of one name with its `=` and its `&`. */
const FIELD_BYTES = 6;
const NAME_BYTES = 4;
const BASE = 36;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/**
 * Writes the form in bytes, with no string on the way. The peak only grows, so what a fixture leaves in the heap hides what the
 * reading adds: a form made of a million and a half strings raises the peak by more than the reading does, and leaves the young
 * generation large, by how much depends on the version of Node.js.
 */
function hostileForm(): Uint8Array {
  const digits = new TextEncoder().encode("0123456789abcdefghijklmnopqrstuvwxyz");
  const [equals = 0, ampersand = 0] = new TextEncoder().encode("=&");
  const body = new Uint8Array(NAMES * FIELD_BYTES);
  for (let name = 0; name < NAMES; name += 1) {
    const start = name * FIELD_BYTES;
    let rest = name;
    for (let place = NAME_BYTES - 1; place >= 0; place -= 1) {
      body[start + place] = digits[rest % BASE] ?? 0;
      rest = Math.floor(rest / BASE);
    }
    body[start + NAME_BYTES] = equals;
    body[start + NAME_BYTES + 1] = ampersand;
  }
  return body;
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a hostile form", () => {
  it("refuses a form of a million and a half distinct names by their number, within the budget, without reading it", async () => {
    const request = requestOf("POST", "/statements", {
      query: { method: "GET" },
      headers: { "content-type": "application/x-www-form-urlencoded", "x-experience-api-version": "1.0.3" },
      body: hostileForm(),
    });
    const before = peak();
    const answer = await handleLrsRequest(request, optionsOf(memory()));
    expect(answer.status).toBe(400);
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
