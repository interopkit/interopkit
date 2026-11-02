import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { readLaunchUrl } from "../src/index.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the reading may raise the peak by. A reader that parsed the actor first would hold every token of it. */
const BUDGET = 16 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a launch URL at its limit, with an actor of the most tokens it holds", () => {
  it("stays within the budget, and refuses the actor before it parses it", async ({ annotate }) => {
    const base =
      "https://content.example.org/au/1/index.html?endpoint=https://lms.example.org/xapi/&fetch=https://lms.example.org/f" +
      "&registration=1b0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d&activityId=https://lms.example.org/au/1&actor=";
    const tokens = Math.floor((65_536 - base.length - 2) / 2);
    const url = `${base}[${"0,".repeat(tokens - 1)}0]`;
    expect(url.length).toBeLessThanOrEqual(65_536);
    const before = peak();
    expect(() => readLaunchUrl(url)).toThrow(
      new DataError("The actor of the launch URL has more than 1000 tokens of JSON, more than an Agent needs."),
    );
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
