import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { guidesWithSamples, runGuideSamples, typecheckGuideSamples } from "../../../scripts/guide-samples.js";
import * as baking from "../src/baking/index.js";
import * as root from "../src/index.js";

const modules = { "@interopkit/achievement-credentials": root, "@interopkit/achievement-credentials/baking": baking };
const GUIDES = new URL("../../../docs/achievement-credentials/", import.meta.url);
const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
/** Where the packages that the samples and the sources import resolve to: the sources, so that no build is needed. */
const PATHS = {
  "@interopkit/achievement-credentials": [`${PACKAGES}achievement-credentials/src/index.ts`],
  "@interopkit/achievement-credentials/baking": [`${PACKAGES}achievement-credentials/src/baking/index.ts`],
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

  it.each(guides)("run in the guide %s and show their results", async (guide) => {
    expect(await runGuideSamples(new URL(guide, GUIDES), modules)).toBeGreaterThan(0);
  });

  it.each(guides)("compile as TypeScript in the guide %s", (guide) => {
    expect(typecheckGuideSamples(new URL(guide, GUIDES), PATHS)).toStrictEqual([]);
  });
});
