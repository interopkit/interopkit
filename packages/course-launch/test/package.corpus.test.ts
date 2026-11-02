import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import { describe, expect, it } from "vitest";
import { readCourseStructure } from "../src/index.js";
import { readCoursePackage } from "../src/package/index.js";
import { catapult } from "./cmi5-corpus.js";

/** Zips a folder of the LMS suite, as its build does for the packages it imports. */
async function zipFolder(folder: string): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter("application/zip"), { useWebWorkers: false });
  for (const name of readdirSync(folder))
    await writer.add(name, new Uint8ArrayReader(readFileSync(join(folder, name))));
  return writer.close();
}

const SUITE = () => join(catapult(), "lts/pkg/src");

describe("the course packages of CATAPULT", () => {
  const packages = readdirSync(join(catapult(), "course_examples/packages"));

  it("are six ZIP archives", () => {
    expect(packages).toHaveLength(6);
  });

  it.each(packages)("reads %s, whose files hold every launch point of its structure", async (name) => {
    const read = await readCoursePackage(readFileSync(join(catapult(), "course_examples/packages", name)));
    expect(read.source).toBe("zip");
    expect(read.paths).toContain("cmi5.xml");
    const folder = join(catapult(), "course_examples", name.replace(/\.zip$/u, ""), "cmi5.xml");
    expect(read.structure).toStrictEqual(readCourseStructure(readFileSync(folder), { packaged: true }));
  });
});

describe("the packages of the LMS suite of CATAPULT that the suite rejects as packages", () => {
  it("refuses 203-1, whose relative URL names no file of the package", async () => {
    await expect(readCoursePackage(await zipFolder(join(SUITE(), "203-1-relative-url-no-reference")))).rejects.toThrow(
      'The course package has no file "not-found.html", which the URL of the assignable unit at children[0] names.',
    );
  });

  it("refuses 210-1, which has no cmi5.xml at its root", async () => {
    await expect(readCoursePackage(await zipFolder(join(SUITE(), "210-1-no-cmi5-xml")))).rejects.toThrow(
      "The ZIP package has no cmi5.xml at its root",
    );
  });

  it.each(["208-1-invalid-package.md", "209-1-not-a-zip.zip"])(
    "refuses %s, which is neither a ZIP archive nor XML",
    async (name) => {
      await expect(readCoursePackage(readFileSync(join(SUITE(), name)))).rejects.toThrow(
        "The course package is neither a ZIP archive nor the XML of a course structure",
      );
    },
  );

  it("reads 101, a structure of 1,001 assignable units, as a package of XML", async () => {
    const read = await readCoursePackage(readFileSync(join(SUITE(), "101-one-thousand-aus.xml")));
    expect(read.source).toBe("xml");
    expect(read.structure.children).toHaveLength(1_001);
  });
});
