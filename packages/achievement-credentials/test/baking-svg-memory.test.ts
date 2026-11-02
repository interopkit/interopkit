import { describe, expect, it } from "vitest";
import { readSvg } from "../src/baking/index.js";
import { DEFAULT_MAX_BYTES } from "../src/baking/internal.js";

const MIB = 1024 * 1024;
/**
 * The bytes that one reading may raise the peak of the process by. The SVG below is at the size limit of an image and holds a
 * credential of one string of nearly all of it, which the parser of the XML and the parser of the JSON each hold once; an
 * image ten times its size, which the limit refuses by its length, would take about ten times as much.
 */
const BUDGET = 64 * MIB;
/** Room left for the elements around the credential. */
const FRAME_CHARACTERS = 1024;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a hostile SVG", () => {
  it("stays within the budget for an SVG at the size limit whose credential is one long string", () => {
    const value = "x".repeat(DEFAULT_MAX_BYTES - FRAME_CHARACTERS);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:openbadges="https://purl.imsglobal.org/ob/v3p0"><openbadges:credential><![CDATA[{"a":"${value}"}]]></openbadges:credential></svg>`;
    expect(svg.length).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
    const before = peak();
    const read = readSvg(svg);
    const grown = peak() - before;
    expect(read).toStrictEqual({ kind: "badge", credential: { a: value } });
    expect(grown).toBeLessThan(BUDGET);
  });
});
