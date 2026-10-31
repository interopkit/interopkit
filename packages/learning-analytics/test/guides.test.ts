import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";
import { runGuideSamples } from "./guide-samples.js";

const modules = { "@interopkit/learning-analytics": root };
const GUIDES = new URL("../../../docs/learning-analytics/", import.meta.url);
const guides = readdirSync(GUIDES).filter((name) => name.endsWith(".md"));

describe("the samples of the documentation", () => {
  it("run in the README of the package and show their results", async () => {
    expect(await runGuideSamples(new URL("../README.md", import.meta.url), modules)).toBeGreaterThan(0);
  });

  it.each(guides)("run in the guide %s and show their results", async (guide) => {
    expect(await runGuideSamples(new URL(guide, GUIDES), modules)).toBeGreaterThan(0);
  });
});
