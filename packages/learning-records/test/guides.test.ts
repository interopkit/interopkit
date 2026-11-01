import { fileURLToPath } from "node:url";
import * as core from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { guidesWithSamples, runGuideSamples, typecheckGuideSamples } from "../../../scripts/guide-samples.js";
import * as attachments from "../src/attachments/index.js";
import * as client from "../src/client/index.js";
import * as root from "../src/index.js";
import * as signing from "../src/signing/index.js";
import * as store from "../src/store/index.js";

const modules = {
  "@interopkit/core": core,
  "@interopkit/learning-records": root,
  "@interopkit/learning-records/attachments": attachments,
  "@interopkit/learning-records/client": client,
  "@interopkit/learning-records/signing": signing,
  "@interopkit/learning-records/store": store,
};
const GUIDES = new URL("../../../docs/learning-records/", import.meta.url);
const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
/** Where the packages that the samples and the sources import resolve to: the sources, so that no build is needed. */
const PATHS = {
  "@interopkit/learning-records": [`${PACKAGES}learning-records/src/index.ts`],
  "@interopkit/learning-records/attachments": [`${PACKAGES}learning-records/src/attachments/index.ts`],
  "@interopkit/learning-records/client": [`${PACKAGES}learning-records/src/client/index.ts`],
  "@interopkit/learning-records/signing": [`${PACKAGES}learning-records/src/signing/index.ts`],
  "@interopkit/learning-records/store": [`${PACKAGES}learning-records/src/store/index.ts`],
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
