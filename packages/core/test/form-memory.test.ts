import { describe, expect, it } from "vitest";
import { readForm } from "../src/http/index.js";

const MIB = 1024 * 1024;
/**
 * The bytes that one reading may raise the peak of the process by. The form below is 10 MiB of one value of `+`, which is a
 * space: left to URLSearchParams, which joins a node of a rope for each in Node.js, it raised the peak by 368 MiB on Node.js 22
 * and 467 MiB on 24; replaced on the bytes, by about 20 MiB.
 */
const BUDGET = 64 * MIB;
/** The bytes of the form: ten times the default limit of a JSON body, which a host may allow a form. */
const FORM_BYTES = 10 * MIB;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a hostile form", () => {
  it("stays within the budget for a form of 10 MiB of plus signs", () => {
    const body = new TextEncoder().encode(`a=${"+".repeat(FORM_BYTES - 2)}`);
    const before = peak();
    const form = readForm({
      method: "POST",
      url: "https://provider.example/",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const grown = peak() - before;
    expect(form.get("a")?.length).toBe(FORM_BYTES - 2);
    expect(grown).toBeLessThan(BUDGET);
  });
});
