import { describe, expect, it } from "vitest";
import { handleLrsRequest } from "../src/store/index.js";
import { memory, optionsOf, requestOf } from "./memory-lrs.js";

const MIB = 1024 * 1024;
/** The bytes that the reading may raise the peak of the process by. With a rope node for each `+`, the form below took 416 MiB. */
const BUDGET = 128 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a form of spaces", () => {
  it("reads a form of 10 MiB written as + within the budget, before the request is authenticated", async () => {
    const request = requestOf("POST", "/statements", {
      query: { method: "POST" },
      headers: { "content-type": "application/x-www-form-urlencoded", "x-experience-api-version": "1.0.3" },
      body: `content=${"+".repeat(10 * MIB - 8)}`,
    });
    const before = peak();
    const answer = await handleLrsRequest(request, optionsOf(memory()));
    expect(answer.status).toBe(400);
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
