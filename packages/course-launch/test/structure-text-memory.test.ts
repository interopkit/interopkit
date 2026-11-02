import { describe, expect, it } from "vitest";
import { readCourseStructure } from "../src/index.js";
import { structure, TEXTS } from "./course-xml.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the reading may raise the peak by: the text of 16 MiB in pieces, joined, and in the model. */
const BUDGET = 192 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading one langstring of almost 16 MiB", () => {
  it("stays within the budget", async ({ annotate }) => {
    const text = "a ".repeat((16 * MIB - 2_000) / 2);
    const xml = structure(undefined, { courseInner: TEXTS.replace(">T<", `>${text}<`) });
    const before = peak();
    expect(readCourseStructure(xml).course.title[0]?.text).toHaveLength(text.length - 1);
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
