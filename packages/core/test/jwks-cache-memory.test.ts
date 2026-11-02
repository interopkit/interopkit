import { describe, expect, it } from "vitest";
import { createJwksCache, DataError, type Fetch, ServiceError } from "../src/index.js";

const MIB = 1024 * 1024;
/** The bytes that reading the key sets below may raise the peak of the process by: parsing the set of 64 MiB would take more. */
const BUDGET = 32 * MIB;
/** The most bytes of the answer of a key set. */
const MAX_BYTES = 65_536;
const URL_OF_SET = "https://lms.example.edu/jwks";
/** The most keys of a key set. */
const MAX_KEYS = 100;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** An answer of 64 MiB of keys, which the network delivers a chunk at a time, as the reading asks for them. */
function hugeAnswer(): Response {
  const encoder = new TextEncoder();
  const chunk = encoder.encode("{},".repeat(21_845));
  let chunks = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        chunks += 1;
        if (chunks === 1) controller.enqueue(encoder.encode('{"keys":['));
        else if (chunks <= 1024) controller.enqueue(chunk);
        else controller.close();
      },
    }),
  );
}

/** Resolves a key from the set at the URL, with a cache that keeps nothing between the readings. */
function resolve(body: string | (() => Response)) {
  const fetch: Fetch = async () => (typeof body === "string" ? new Response(body) : body());
  const cache = createJwksCache({ fetch, clock: { now: () => 1_700_000_000_000 } });
  return cache.keySet(URL_OF_SET)({ alg: "RS256", kid: "k" }, { payload: "", signature: "" });
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one cache.
describe("the peak memory of reading a key set", () => {
  it("stays within the budget for the sets at the limits of bytes and keys, one nested too deep to copy, and one far above", async () => {
    // Each `{},` is one key of three bytes: the most keys that an answer at the limit can hold, refused by their number.
    const keys = `{"keys":[${"{},".repeat(Math.floor((MAX_BYTES - 12) / 3) - 1)}{}]}`;
    // The most keys that a set may have, each with a member that fills the answer to its limit.
    const filler = "a".repeat(Math.floor(MAX_BYTES / MAX_KEYS) - 12);
    const large = `{"keys":[${Array.from({ length: MAX_KEYS }, () => `{"x":"${filler}"}`).join(",")}]}`;
    const nested = `{"keys":[{"x":${"[".repeat(32_000)}${"]".repeat(32_000)}}]}`;
    for (const text of [keys, large, nested]) expect(text.length).toBeLessThanOrEqual(MAX_BYTES);
    expect(keys.length).toBeGreaterThan(MAX_BYTES - 8);
    expect(large.length).toBeGreaterThan(MAX_BYTES - 1500);
    const before = peak();
    await expect(resolve(keys)).rejects.toThrow("above the limit of 100");
    await expect(resolve(large)).rejects.toMatchObject({ code: "ERR_JWKS_NO_MATCHING_KEY" });
    await expect(resolve(nested)).rejects.toBeInstanceOf(DataError);
    await expect(resolve(hugeAnswer)).rejects.toBeInstanceOf(ServiceError);
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
