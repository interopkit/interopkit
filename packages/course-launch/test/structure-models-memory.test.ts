import { describe, expect, it } from "vitest";
import { readCourseStructure } from "../src/index.js";
import { structure, TEXTS } from "./course-xml.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the reading may raise the peak by: the model of almost a million texts, about 140 MiB. */
const BUDGET = 256 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a structure of a million texts, at the limit of elements", () => {
  it("stays within the budget", async ({ annotate }) => {
    const texts = "<langstring/>".repeat(999_900);
    const xml = structure(undefined, { courseInner: TEXTS.replace("<title>", `<title>${texts}`) });
    const before = peak();
    expect(readCourseStructure(xml).course.title).toHaveLength(999_901);
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
