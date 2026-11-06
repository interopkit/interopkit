import { fileURLToPath } from "node:url";
import * as checks from "@interopkit/core/checks";
import { describe, expect, it } from "vitest";
import {
  guidesWithSamples,
  runGuideSamples,
  runTsdocExamples,
  typecheckTsdocExamples,
} from "../../../scripts/guide-samples.js";
import * as endpoint from "../src/endpoint/index.js";
import * as root from "../src/index.js";

const modules = {
  "@interopkit/core/checks": checks,
  "@interopkit/learning-analytics": root,
  "@interopkit/learning-analytics/endpoint": endpoint,
};
const GUIDES = new URL("../../../docs/learning-analytics/", import.meta.url);
const SOURCES = new URL("../src/", import.meta.url);
const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
/** Where the packages that the examples and the sources import resolve to: the sources, so that no build is needed. */
const PATHS = {
  "@interopkit/learning-analytics": [`${PACKAGES}learning-analytics/src/index.ts`],
  "@interopkit/learning-analytics/endpoint": [`${PACKAGES}learning-analytics/src/endpoint/index.ts`],
  "@interopkit/core": [`${PACKAGES}core/src/index.ts`],
  "@interopkit/core/checks": [`${PACKAGES}core/src/checks.ts`],
  "@interopkit/core/http": [`${PACKAGES}core/src/http/index.ts`],
};
const guides = guidesWithSamples(GUIDES);

describe("the samples of the documentation", () => {
  it("run in the README of the package and show their results", async () => {
    expect(await runGuideSamples(new URL("../README.md", import.meta.url), modules)).toBeGreaterThan(0);
  });

  it.each(guides)("run in the guide %s and show their results", async (guide) => {
    expect(await runGuideSamples(new URL(guide, GUIDES), modules)).toBeGreaterThan(0);
  });
});

describe("the examples of the TSDoc comments", () => {
  it("run and show their results", async () => {
    expect(await runTsdocExamples(SOURCES, modules)).toBeGreaterThan(0);
  });

  it("compile as TypeScript", () => {
    expect(typecheckTsdocExamples(SOURCES, PATHS)).toStrictEqual([]);
  });
});
