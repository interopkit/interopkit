import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import { describe, expect, it } from "vitest";
import { readCoursePackage } from "../src/package/index.js";
import { structure } from "./course-xml.js";
import { MIB, peak, risen } from "./memory.js";

/**
 * The bytes that the reading may raise the peak by: the entries that zip.js makes, a few kilobytes each, about 250 MiB at the
 * limit. A reader that kept every entry would take about 600 MiB, and one without the limit as much more as the archive has.
 */
const BUDGET = 448 * MIB;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a package of 100,000 entries, the limit", () => {
  it("stays within the budget", async ({ annotate }) => {
    const writer = new ZipWriter(new BlobWriter("application/zip"), { useWebWorkers: false });
    await writer.add("cmi5.xml", new TextReader(structure()));
    for (let index = 1; index < 100_000; index += 1) await writer.add(`media/${index}.bin`, undefined);
    const archive = await writer.close();
    const before = peak();
    expect((await readCoursePackage(archive)).paths).toHaveLength(100_000);
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
