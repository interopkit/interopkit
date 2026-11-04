import { expect, type TestContext } from "vitest";
import { alternate, reportRatio } from "../../../scripts/bench-rounds.js";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/** The number of members, results and line items of the pages that the benchmarks read and write. */
export const PAGE_SIZE = 1000;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of a reference in the same run:
 * five times the highest ratio measured on the runner of CI and on a laptop, rounded up to one significant digit, as
 * docs/tool-integration/evidence.md explains. Both samples come from one run, so a ratio holds on any machine.
 */
export const RATIOS = {
  /** `handleLaunch` with an RS256 `id_token`, as a multiple of `jwtVerify` of jose on the same token. Measured 2.37 to 3.20. */
  launchRs256: 20,
  /** `handleLaunch` with an ES256 `id_token`, as a multiple of `jwtVerify` of jose on the same token. Measured 1.71 to 2.22. */
  launchEs256: 20,
  /** The authorization request that issues an RS256 `id_token` with every claim, as a multiple of `SignJWT` of jose on the same claims. Measured 1.18 to 1.94. */
  authorizeRs256: 10,
  /** The same with ES256. Measured 2.06 to 3.43. */
  authorizeEs256: 20,
  /** `members` of a page of 1,000 members, as a multiple of `JSON.parse` of its text. Measured 4.12 to 6.21. */
  members: 40,
  /** `results` of a page of 1,000 results, as a multiple of `JSON.parse` of its text. Measured 6.22 to 9.59. */
  results: 50,
  /** `lineItems` of a page of 1,000 line items, as a multiple of `JSON.parse` of its text. Measured 8.48 to 12.8. */
  lineItems: 70,
  /** The key that the key set cache resolves from a set it holds, as a multiple of `createLocalJWKSet` of jose on the same set. Measured 2.64 to 5.79. */
  jwksAgainstLocal: 30,
  /** The same, as a multiple of `createRemoteJWKSet` of jose that holds the same set. Measured 1.82 to 2.47. */
  jwksAgainstRemote: 20,
  /** `publishScore` of a score, as a multiple of `callService` of core sending the same request to the same answer. Measured 2.74 to 4.21. */
  publishScore: 30,
  /** `control` of a request of the Assessment Control Service, as a multiple of `callService` of the same request. Measured 1.83 to 3.06. */
  control: 20,
  /** `registerTool` of a tool's configuration, as a multiple of `callService` of the same request. Measured 2.92 to 6.00. */
  registerTool: 40,
  /** The token endpoint of the platform, as a multiple of `jwtVerify` of jose on the client assertion of the request. Measured 2.52 to 3.92. */
  tokenEndpoint: 20,
  /** The handler of the members of a context, a page of 1,000, as a multiple of `JSON.stringify` of the page. Measured 5.54 to 8.59. */
  membersHandler: 50,
  /** The handler of the results of a line item, a page of 1,000, as a multiple of `JSON.stringify` of the page. Measured 7.37 to 11.7. */
  resultsHandler: 60,
  /** The handler of a score, as a multiple of `compactVerify` of jose on its access token and `JSON.parse` of its body. Measured 3.06 to 4.07. */
  scoreHandler: 30,
  /** The handler of a request of the Assessment Control Service, as a multiple of the same. Measured 3.00 to 3.94. */
  controlHandler: 20,
  /** The handler of a registration, as a multiple of the same and `JSON.stringify` of its answer. Measured 3.30 to 4.41. */
  registrationHandler: 30,
  /** `buildDeepLinkingResponse` with five items, one of each type, as a multiple of `SignJWT` of jose on the same claims. Measured 1.04 to 1.28. */
  deepLinkingResponse: 7,
  /** `readDeepLinkingResponse` of the same, as a multiple of `jwtVerify` of jose on its JWT. Measured 3.20 to 4.44. */
  readDeepLinkingResponse: 30,
  /** `buildStartAssessmentPage`, as a multiple of `SignJWT` of jose on the same claims. Measured 1.03 to 1.21. */
  startAssessment: 7,
  /** `readStartAssessment` of the same, as a multiple of `jwtVerify` of jose on its JWT. Measured 2.45 to 3.04. */
  readStartAssessment: 20,
  /** `handleLaunch` of a message with every claim, as a multiple of `verifyLaunch` of `@lti-tool/core` on the same message. Measured 1.05 to 1.42. */
  launchAgainstLtiTool: 8,
  /** The same, as a multiple of `validate` of `lti-core`. Measured 1.84 to 2.13. */
  launchAgainstLtiCore: 20,
  /** The authorization request that substitutes the 44 variables that the platform supports, as a multiple of the same request with plain values. Measured 0.98 to 1.05. */
  substitution: 6,
} as const;

/** A function to time, and its name in the report. */
export interface Timed {
  readonly name: string;
  readonly fn: () => unknown;
}

/**
 * Times a function and its reference in turns (`alternate` of `scripts/bench-rounds.ts`), reports both, and fails the test when
 * the fastest sample of the function is above its ratio to the fastest sample of the reference.
 */
export async function expectRatioInTurns(
  context: Pick<TestContext, "annotate" | "bench">,
  name: keyof typeof RATIOS,
  reference: Timed,
  measured: Timed,
): Promise<void> {
  const sides = await alternate(
    context.bench,
    measured.name,
    measured.fn,
    { name: reference.name, run: reference.fn },
    BENCH_OPTIONS,
  );
  const ratio = await reportRatio(context.annotate, name, reference.name, sides, RATIOS[name]);
  expect(ratio, `The fastest sample of ${name} as a multiple of the fastest sample of ${reference.name}`).toBeLessThan(
    RATIOS[name],
  );
}
