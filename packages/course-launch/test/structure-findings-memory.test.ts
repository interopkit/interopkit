import { describe, expect, it } from "vitest";
import { validateCourseStructure } from "../src/index.js";
import { structure, TEXTS } from "./course-xml.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the judgment may raise the peak by. A judgment that kept a finding for each wrong value would take about 1 GB. */
const BUDGET = 64 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one judgment.
describe("the peak memory of judging a structure of a million wrong values", () => {
  it("stays within the budget, and lists the findings of the limit and one that says it stopped", async ({
    annotate,
  }) => {
    const wrong = '<x xmlns=""/>'.repeat(999_000);
    const xml = structure(undefined, { courseInner: `${TEXTS}${wrong}` });
    const before = peak();
    const findings = validateCourseStructure(xml);
    const rise = peak() - before;
    expect(findings).toHaveLength(1_001);
    expect(findings.at(-1)?.rule).toBe("findings-stopped");
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
