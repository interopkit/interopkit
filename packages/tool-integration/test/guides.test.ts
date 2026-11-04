import * as core from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { guidesWithSamples, runGuideSamples } from "../../../scripts/guide-samples.js";
import * as root from "../src/index.js";
import * as platform from "../src/platform/index.js";
import * as tool from "../src/tool/index.js";

const modules = {
  "@interopkit/core": core,
  "@interopkit/tool-integration": root,
  "@interopkit/tool-integration/platform": platform,
  "@interopkit/tool-integration/tool": tool,
};
const GUIDES = new URL("../../../docs/tool-integration/", import.meta.url);
const guides = guidesWithSamples(GUIDES);

describe("the samples of the documentation", () => {
  it("run in the README of the package and show their results", async () => {
    expect(await runGuideSamples(new URL("../README.md", import.meta.url), modules)).toBeGreaterThan(0);
  });

  it.each(guides)("run in the guide %s and show their results", async (guide) => {
    expect(await runGuideSamples(new URL(guide, GUIDES), modules)).toBeGreaterThan(0);
  });
});
