import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  guidesWithSamples,
  runGuideSamples,
  runTsdocExamples,
  typecheckTsdocExamples,
} from "../../../scripts/guide-samples.js";
import * as checks from "../src/checks.js";
import * as http from "../src/http/index.js";
import * as root from "../src/index.js";
import * as oauth from "../src/oauth/index.js";

const modules = {
  "@interopkit/core": root,
  "@interopkit/core/checks": checks,
  "@interopkit/core/http": http,
  "@interopkit/core/oauth": oauth,
};
const GUIDES = new URL("../../../docs/core/", import.meta.url);
const SOURCES = new URL("../src/", import.meta.url);
const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
/** Where the packages that the examples and the sources import resolve to: the sources, so that no build is needed. */
const PATHS = {
  "@interopkit/core": [`${PACKAGES}core/src/index.ts`],
  "@interopkit/core/checks": [`${PACKAGES}core/src/checks.ts`],
  "@interopkit/core/http": [`${PACKAGES}core/src/http/index.ts`],
  "@interopkit/core/oauth": [`${PACKAGES}core/src/oauth/index.ts`],
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
