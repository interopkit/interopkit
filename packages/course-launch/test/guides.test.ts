import { fileURLToPath } from "node:url";
import * as core from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { guidesWithSamples, runGuideSamples, typecheckGuideSamples } from "../../../scripts/guide-samples.js";
import * as au from "../src/au/index.js";
import * as root from "../src/index.js";
import * as lms from "../src/lms/index.js";
import * as coursePackage from "../src/package/index.js";

const modules = {
  "@interopkit/core": core,
  "@interopkit/course-launch": root,
  "@interopkit/course-launch/au": au,
  "@interopkit/course-launch/lms": lms,
  "@interopkit/course-launch/package": coursePackage,
};
const GUIDES = new URL("../../../docs/course-launch/", import.meta.url);
const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
/** Where the packages that the samples and the sources import resolve to: the sources, so that no build is needed. */
const PATHS = {
  "@interopkit/course-launch": [`${PACKAGES}course-launch/src/index.ts`],
  "@interopkit/course-launch/au": [`${PACKAGES}course-launch/src/au/index.ts`],
  "@interopkit/course-launch/lms": [`${PACKAGES}course-launch/src/lms/index.ts`],
  "@interopkit/course-launch/package": [`${PACKAGES}course-launch/src/package/index.ts`],
  "@interopkit/learning-records": [`${PACKAGES}learning-records/src/index.ts`],
  "@interopkit/learning-records/client": [`${PACKAGES}learning-records/src/client/index.ts`],
  "@interopkit/learning-records/store": [`${PACKAGES}learning-records/src/store/index.ts`],
  "@interopkit/core": [`${PACKAGES}core/src/index.ts`],
  "@interopkit/core/checks": [`${PACKAGES}core/src/checks.ts`],
};
const guides = guidesWithSamples(GUIDES);

describe("the samples of the documentation", () => {
  it("run in the README of the package and show their results", async () => {
    expect(await runGuideSamples(new URL("../README.md", import.meta.url), modules)).toBeGreaterThan(0);
  });

  it("compile as TypeScript in the README of the package", () => {
    expect(typecheckGuideSamples(new URL("../README.md", import.meta.url), PATHS)).toStrictEqual([]);
  });

  it("are in at least one guide", () => {
    expect(guides.length).toBeGreaterThan(0);
  });

  it.each(guides)("run in the guide %s and show their results", async (guide) => {
    expect(await runGuideSamples(new URL(guide, GUIDES), modules)).toBeGreaterThan(0);
  });

  it.each(guides)("compile as TypeScript in the guide %s", (guide) => {
    expect(typecheckGuideSamples(new URL(guide, GUIDES), PATHS)).toStrictEqual([]);
  });
});
