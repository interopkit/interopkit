import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readCourseStructure } from "../src/index.js";
import { readCoursePackage, writeCoursePackage } from "../src/package/index.js";
import { withUrl } from "./course-xml.js";

// The archives of tens of thousands of entries take seconds to write and read, more than the rules of check:rules wait for.

/** An archive that `validation/cmi5_archives.py` wrote with Python's zipfile, gzipped. */
const archive = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/archives/${name}`, import.meta.url)));

describe("archives of tens of thousands of entries", () => {
  it("reads ZIP64 of 66,001 entries, and a count of 70,002 entries that wrapped past 65,535 without ZIP64", async () => {
    expect((await readCoursePackage(archive("zip64-many.zip.gz"))).paths).toHaveLength(66_001);
    expect((await readCoursePackage(archive("wrapped.zip.gz"))).paths).toHaveLength(70_002);
  });

  it("refuses to write a package that its reader would refuse at its default limits", async () => {
    const structure = readCourseStructure(withUrl("index.html"), { packaged: true });
    const many = new Map<string, Uint8Array>([["index.html", new TextEncoder().encode("x")]]);
    for (let index = 0; index < 100_000; index += 1) many.set(`f/${index}`, new Uint8Array());
    await expect(writeCoursePackage(structure, many)).rejects.toThrow(
      "The package has 100001 files and cmi5.xml, more than the 100000 entries that readCoursePackage takes by default.",
    );
  });
});
