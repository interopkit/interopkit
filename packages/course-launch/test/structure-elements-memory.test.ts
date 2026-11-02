import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { readCourseStructure } from "../src/index.js";
import { structure, TEXTS } from "./course-xml.js";
import { MIB, peak, risen } from "./memory.js";

/**
 * The bytes that the reading may raise the peak by: the model of the million texts that it reads before the limit, about
 * 140 MiB. A reading without the limits of bytes and elements would keep a text for each of 80 million in a gigabyte.
 */
const BUDGET = 256 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading 16 MiB of empty elements", () => {
  it("stays within the budget, and refuses the structure at the limit of elements", async ({ annotate }) => {
    const empties = "<langstring/>".repeat(Math.floor((16 * MIB - 1_000) / 13));
    const xml = structure(undefined, { courseInner: TEXTS.replace("<title>", `<title>${empties}`) });
    const before = peak();
    expect(() => readCourseStructure(xml)).toThrow(
      new DataError(
        "The course structure has more than 1000000 elements and attributes, the limit of the option maxElements.",
      ),
    );
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
