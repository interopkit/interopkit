import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { guidesWithSamples, runGuideSamples, typecheckGuideSamples } from "../../../scripts/guide-samples.js";
import * as client from "../src/client/index.js";
import * as graph from "../src/graph/index.js";
import * as root from "../src/index.js";
import * as provider from "../src/provider/index.js";

const modules = {
  "@interopkit/competency-frameworks": root,
  "@interopkit/competency-frameworks/client": client,
  "@interopkit/competency-frameworks/graph": graph,
  "@interopkit/competency-frameworks/provider": provider,
};
const GUIDES = new URL("../../../docs/competency-frameworks/", import.meta.url);
const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
/** Where the packages that the samples and the sources import resolve to: the sources, so that no build is needed. */
const PATHS = {
  "@interopkit/competency-frameworks": [`${PACKAGES}competency-frameworks/src/index.ts`],
  "@interopkit/competency-frameworks/client": [`${PACKAGES}competency-frameworks/src/client/index.ts`],
  "@interopkit/competency-frameworks/graph": [`${PACKAGES}competency-frameworks/src/graph/index.ts`],
  "@interopkit/competency-frameworks/provider": [`${PACKAGES}competency-frameworks/src/provider/index.ts`],
  "@interopkit/core": [`${PACKAGES}core/src/index.ts`],
  "@interopkit/core/checks": [`${PACKAGES}core/src/checks.ts`],
  "@interopkit/core/http": [`${PACKAGES}core/src/http/index.ts`],
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
