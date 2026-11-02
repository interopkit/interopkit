import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readCoursePackage } from "../src/package/index.js";
import { MIB, peak, risen } from "./memory.js";

/** The bytes that the reading may raise the peak by. A reader that inflated the whole cmi5.xml would take 64 MiB and more. */
const BUDGET = 32 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a package whose cmi5.xml inflates to 64 MiB and says it has 64 bytes", () => {
  it("stays within the budget, and refuses the package", async ({ annotate }) => {
    const archive = readFileSync(new URL("./fixtures/archives/lying-bomb.zip", import.meta.url));
    const before = peak();
    await expect(readCoursePackage(archive)).rejects.toThrow("Invalid uncompressed size");
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
