import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bakePng, readPng } from "../src/baking/index.js";
import { achievementCredential } from "./fixtures.js";

const MIB = 1024 * 1024;
/**
 * The bytes that one reading may raise the peak of the process by. The credential below holds the most objects of JSON that the
 * limit of tokens leaves room for, which the reading parses; ten times as many, which the limit refuses, would take about ten
 * times as much.
 */
const BUDGET = 128 * MIB;
/** The most tokens of JSON in a credential of an image, `maxTokens`. */
const TOKENS = 1_000_000;
/** The tokens of an empty object in a list: its two braces and a comma. */
const TOKENS_PER_OBJECT = 3;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/baking/baked-images.json", import.meta.url), "utf8")) as {
  png: { base: string };
};

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a hostile image", () => {
  it("stays within the budget for a PNG whose credential holds the most objects of JSON that the limits leave", () => {
    const count = Math.floor(TOKENS / TOKENS_PER_OBJECT) - 200;
    const credential = { ...achievementCredential(), extra: new Array(count).fill({}) };
    const image = bakePng(Uint8Array.from(Buffer.from(FIXTURE.png.base, "base64")), credential);
    const before = peak();
    const read = readPng(image);
    const grown = peak() - before;
    expect(read?.kind).toBe("badge");
    expect(grown).toBeLessThan(BUDGET);
  });
});
