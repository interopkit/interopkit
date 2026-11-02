import { describe, expect, it } from "vitest";
import { handleLrsRequest } from "../src/store/index.js";
import { memory, optionsOf, requestOf } from "./memory-lrs.js";

const MIB = 1024 * 1024;
/** The bytes that a refusal may raise the peak of the process by. Read into a map, the form below took 126 to 148 MiB; refused, 9 MiB. */
const BUDGET = 64 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a hostile form", () => {
  it("refuses a form of a million and a half distinct names by their number, within the budget, without reading it", async () => {
    const body = Array.from({ length: 1_500_000 }, (_, index) => `${index.toString(36)}=`).join("&");
    const request = requestOf("POST", "/statements", {
      query: { method: "GET" },
      headers: { "content-type": "application/x-www-form-urlencoded", "x-experience-api-version": "1.0.3" },
      body,
    });
    const before = peak();
    const answer = await handleLrsRequest(request, optionsOf(memory()));
    expect(answer.status).toBe(400);
    expect(peak() - before).toBeLessThan(BUDGET);
  });
});
