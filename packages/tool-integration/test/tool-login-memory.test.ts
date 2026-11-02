import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { ltiLogin } from "../src/tool/index.js";
import { LOGIN_URL } from "./fake-platform.js";
import { request } from "./fixture.js";
import { setup } from "./tool-setup.js";

const MIB = 1024 * 1024;
/** The bytes that the logins may raise the peak of the process by: decoding the form of 64 MiB below would take more. */
const BUDGET = 32 * MIB;
/** The most bytes of the form of a login initiation. */
const MAX_INITIATION_BYTES = 65_536;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** A login initiation that a platform posts as a form. */
function formPost(body: string) {
  return request({
    url: LOGIN_URL,
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures the readings of one function.
describe("the peak memory of a login initiation", () => {
  it("stays within the budget for initiations at the limit of repeated and of distinct parameters, and for a form far above it", async ({
    annotate,
  }) => {
    const ctx = setup();
    // Each `a=&` is one parameter of three bytes: the most parameters that a form at the limit can hold.
    const repeated = "a=&".repeat(Math.floor(MAX_INITIATION_BYTES / 3));
    const distinct = Array.from(
      { length: Math.floor(MAX_INITIATION_BYTES / 8) },
      (_, index) => `p${index.toString(36)}=`,
    )
      .join("&")
      .slice(0, MAX_INITIATION_BYTES);
    const initiations = [
      formPost(repeated),
      formPost(distinct),
      formPost("a".repeat(64 * MIB)),
      request({ url: `${LOGIN_URL}?${repeated}` }),
      request({ url: `${LOGIN_URL}?${distinct}` }),
    ];
    const before = peak();
    for (const initiation of initiations) await expect(ltiLogin(initiation, ctx.options)).rejects.toThrow(DataError);
    const rise = peak() - before;
    await annotate(`The peak rose by ${(rise / MIB).toFixed(1)} MiB.`);
    expect(rise).toBeLessThan(BUDGET);
  });
});
