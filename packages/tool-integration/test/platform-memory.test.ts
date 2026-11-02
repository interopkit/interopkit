import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "./fixture.js";
import { endpoints, handle, setup } from "./platform-setup.js";

const MIB = 1024 * 1024;
/** The bytes that the requests may raise the peak of the process by: decoding the body of 64 MiB below would take more. */
const BUDGET = 32 * MIB;
/** The most bytes of the body of a request to the platform by default. */
const MAX_BODY_BYTES = 65_536;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** A form POST to a URL of the platform. */
function formTo(url: string, body: string) {
  return request({ url, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
}

afterEach(() => vi.useRealTimers());

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one handler.
describe("the peak memory of the authentication and token requests", () => {
  it("stays within the budget for forms at the limit of repeated parameters, and for forms far above it", async () => {
    const ctx = setup();
    // Each `a=&` is one parameter of three bytes: the most parameters that a form at the limit can hold.
    const repeated = "a=&".repeat(Math.floor(MAX_BODY_BYTES / 3));
    const distinct = Array.from({ length: Math.floor(MAX_BODY_BYTES / 8) }, (_, index) => `p${index.toString(36)}=`)
      .join("&")
      .slice(0, MAX_BODY_BYTES);
    const huge = "a".repeat(64 * MIB);
    const requests = [endpoints.authorization, endpoints.token].flatMap((url) => [
      formTo(url, repeated),
      formTo(url, distinct),
      formTo(url, huge),
    ]);
    const before = peak();
    for (const each of requests) expect([400, 405, 413]).toContain((await handle(ctx, each)).status);
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
