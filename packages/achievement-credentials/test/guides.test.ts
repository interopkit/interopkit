import { fileURLToPath } from "node:url";
import * as core from "@interopkit/core";
import * as oauth from "@interopkit/core/oauth";
import { describe, expect, it } from "vitest";
import { guidesWithSamples, runGuideSamples, typecheckGuideSamples } from "../../../scripts/guide-samples.js";
import * as baking from "../src/baking/index.js";
import * as client from "../src/client/index.js";
import * as dataIntegrity from "../src/data-integrity/index.js";
import * as root from "../src/index.js";
import * as jwt from "../src/jwt/index.js";
import * as keys from "../src/keys/index.js";
import * as refresh from "../src/refresh/index.js";
import * as status from "../src/status/index.js";
import * as verify from "../src/verify/index.js";

const modules = {
  "@interopkit/achievement-credentials": root,
  "@interopkit/achievement-credentials/baking": baking,
  "@interopkit/achievement-credentials/client": client,
  "@interopkit/core/oauth": oauth,
  "@interopkit/achievement-credentials/data-integrity": dataIntegrity,
  "@interopkit/achievement-credentials/jwt": jwt,
  "@interopkit/achievement-credentials/keys": keys,
  "@interopkit/achievement-credentials/refresh": refresh,
  "@interopkit/achievement-credentials/status": status,
  "@interopkit/achievement-credentials/verify": verify,
  "@interopkit/core": core,
};
const GUIDES = new URL("../../../docs/achievement-credentials/", import.meta.url);
const PACKAGES = fileURLToPath(new URL("../../", import.meta.url));
/** Where the packages that the samples and the sources import resolve to: the sources, so that no build is needed. */
const PATHS = {
  "@interopkit/achievement-credentials": [`${PACKAGES}achievement-credentials/src/index.ts`],
  "@interopkit/achievement-credentials/baking": [`${PACKAGES}achievement-credentials/src/baking/index.ts`],
  "@interopkit/achievement-credentials/data-integrity": [
    `${PACKAGES}achievement-credentials/src/data-integrity/index.ts`,
  ],
  "@interopkit/achievement-credentials/jwt": [`${PACKAGES}achievement-credentials/src/jwt/index.ts`],
  "@interopkit/selective-disclosure": [`${PACKAGES}selective-disclosure/src/index.ts`],
  "@interopkit/achievement-credentials/keys": [`${PACKAGES}achievement-credentials/src/keys/index.ts`],
  "@interopkit/achievement-credentials/refresh": [`${PACKAGES}achievement-credentials/src/refresh/index.ts`],
  "@interopkit/achievement-credentials/status": [`${PACKAGES}achievement-credentials/src/status/index.ts`],
  "@interopkit/achievement-credentials/verify": [`${PACKAGES}achievement-credentials/src/verify/index.ts`],
  "@interopkit/core": [`${PACKAGES}core/src/index.ts`],
  "@interopkit/achievement-credentials/client": [`${PACKAGES}achievement-credentials/src/client/index.ts`],
  "@interopkit/core/checks": [`${PACKAGES}core/src/checks.ts`],
  "@interopkit/core/oauth": [`${PACKAGES}core/src/oauth/index.ts`],
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
