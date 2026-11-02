import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { readCourseStructure } from "../src/index.js";
import { structure, TEXTS } from "./course-xml.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the reading may raise the peak by. A reading with no limit of depth would keep a frame for each of 200,000 open blocks. */
const BUDGET = 64 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading blocks nested past the limit of depth", () => {
  it("stays within the budget, and refuses the structure at the limit", async ({ annotate }) => {
    const opening = `<block id="https://example.org/b">${TEXTS}`;
    const depth = Math.floor((16 * MIB - 2_000) / (opening.length + 8));
    const xml = structure(`${opening.repeat(depth)}${"</block>".repeat(depth)}`);
    const before = peak();
    expect(() => readCourseStructure(xml)).toThrow(
      new DataError("The course structure nests more than 64 elements, the limit of the option maxDepth."),
    );
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
