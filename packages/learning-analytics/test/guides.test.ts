import * as checks from "@interopkit/core/checks";
import { describe, expect, it } from "vitest";
import { guidesWithSamples, runGuideSamples } from "../../../scripts/guide-samples.js";
import * as endpoint from "../src/endpoint/index.js";
import * as root from "../src/index.js";

const modules = {
  "@interopkit/core/checks": checks,
  "@interopkit/learning-analytics": root,
  "@interopkit/learning-analytics/endpoint": endpoint,
};
const GUIDES = new URL("../../../docs/learning-analytics/", import.meta.url);
const guides = guidesWithSamples(GUIDES);

describe("the samples of the documentation", () => {
  it("run in the README of the package and show their results", async () => {
    expect(await runGuideSamples(new URL("../README.md", import.meta.url), modules)).toBeGreaterThan(0);
  });

  it.each(guides)("run in the guide %s and show their results", async (guide) => {
    expect(await runGuideSamples(new URL(guide, GUIDES), modules)).toBeGreaterThan(0);
  });
});
