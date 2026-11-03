import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { readCourseStructure } from "@interopkit/course-launch";
import { readCoursePackage } from "@interopkit/course-launch/package";
import { BlobReader, ZipReader } from "@zip.js/zip.js/lib/zip-core-native.js";
import { SaxesParser } from "saxes";
import { test } from "vitest";
import { createXsdOracle } from "../../../scripts/xsd-oracle.js";
import { expectRatioInTurns } from "./budgets.js";
import { catapult, courseStructureXsd } from "./cmi5-corpus.js";

/** LMS suite 101 of CATAPULT: a course structure of 1,001 assignable units, the size the specification names (6.1). */
const THOUSAND_UNITS = () => readFileSync(`${catapult()}/lts/pkg/src/101-one-thousand-aus.xml`, "utf8");

test("reads a structure of 1,001 units within a multiple of libxml2 validating it", async ({ annotate, bench }) => {
  const xml = THOUSAND_UNITS();
  const oracle = createXsdOracle(courseStructureXsd());
  try {
    await expectRatioInTurns(
      { annotate, bench },
      "structureAgainstLibxml2",
      { name: "libxml2", fn: () => oracle.verdict(xml) },
      { name: "readCourseStructure", fn: () => readCourseStructure(xml) },
    );
  } finally {
    oracle.close();
  }
});

test("reads a structure of 1,001 units within a multiple of saxes parsing it alone", async ({ annotate, bench }) => {
  const xml = THOUSAND_UNITS();
  const parse = () => {
    const parser = new SaxesParser({ xmlns: true });
    parser.write(xml).close();
  };
  await expectRatioInTurns(
    { annotate, bench },
    "structureAgainstSaxes",
    { name: "saxes", fn: parse },
    { name: "readCourseStructure", fn: () => readCourseStructure(xml) },
  );
});

test("reads a ZIP64 package of 66,001 entries within a multiple of zip.js listing them", async ({
  annotate,
  bench,
}) => {
  const archive = new Uint8Array(
    gunzipSync(readFileSync(new URL("fixtures/archives/zip64-many.zip.gz", import.meta.url))),
  );
  const blob = new Blob([archive]);
  await expectRatioInTurns(
    { annotate, bench },
    "packageAgainstEntries",
    { name: "zip.js getEntries", fn: async () => new ZipReader(new BlobReader(blob)).getEntries() },
    { name: "readCoursePackage", fn: () => readCoursePackage(blob) },
  );
});
