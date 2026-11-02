import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import { describe, expect, it } from "vitest";
import { readCoursePackage } from "../src/package/index.js";
import { structure } from "./course-xml.js";
import { MIB, peak, risen } from "./memory.js";

/**
 * The bytes that the reading may raise the peak by: the central directory of 64 MiB, read once, and what zip.js decodes of it,
 * about 310 MiB. A reader that kept every entry would take about 1.9 GiB.
 */
const BUDGET = 640 * MIB;

/** The longest comment of an entry, which a central directory holds in full. */
const COMMENT_BYTES = 65_535;

// Each test file runs in a process of its own, and the peak only grows, so this file measures one reading.
describe("the peak memory of reading a package whose central directory is at its limit", () => {
  it("stays within the budget", async ({ annotate }) => {
    const writer = new ZipWriter(new BlobWriter("application/zip"), { useWebWorkers: false });
    await writer.add("cmi5.xml", new TextReader(structure()));
    const comment = "c".repeat(COMMENT_BYTES);
    const entries = Math.floor((64 * MIB - 1_000) / (COMMENT_BYTES + 60));
    for (let index = 1; index < entries; index += 1) await writer.add(`m/${index}`, undefined, { comment });
    const archive = await writer.close();
    const before = peak();
    expect((await readCoursePackage(archive)).paths).toHaveLength(entries);
    const rise = peak() - before;
    await annotate(risen(rise));
    expect(rise).toBeLessThan(BUDGET);
  });
});
