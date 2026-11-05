import { expect, type TestContext } from "vitest";
import { alternate, reportRatio } from "../../../scripts/bench-rounds.js";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/** The number of members, results and line items of the pages that the benchmarks read and write. */
export const PAGE_SIZE = 1000;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of a reference in the same run:
 * twice the highest ratio measured on the runner of CI in 12 runs of the bench job on 2026-11-04 and 2026-11-05, rounded up to one significant digit, as
 * docs/tool-integration/performance.md explains. Both samples come from one run, so a ratio holds on any machine.
 */
export const RATIOS = {
  /** `handleLaunch` with an RS256 `id_token`, as a multiple of `jwtVerify` of jose on the same token. Measured 2.12 to 2.45. */
  launchRs256: 5,
  /** `handleLaunch` with an ES256 `id_token`, as a multiple of `jwtVerify` of jose on the same token. Measured 1.71 to 1.88. */
  launchEs256: 4,
  /** The authorization request that issues an RS256 `id_token` with every claim, as a multiple of `SignJWT` of jose on the same claims. Measured 1.39 to 1.78. */
  authorizeRs256: 4,
  /** The same with ES256. Measured 2.50 to 2.88. */
  authorizeEs256: 6,
  /** `members` of a page of 1,000 members, as a multiple of `JSON.parse` of its text. Measured 3.50 to 4.30. */
  members: 9,
  /** `results` of a page of 1,000 results, as a multiple of `JSON.parse` of its text. Measured 7.06 to 8.41. */
  results: 20,
  /** `lineItems` of a page of 1,000 line items, as a multiple of `JSON.parse` of its text. Measured 9.45 to 11.2. */
  lineItems: 30,
  /** The key that the key set cache resolves from a set it holds, as a multiple of `createLocalJWKSet` of jose on the same set. Measured 2.60 to 4.06. */
  jwksAgainstLocal: 9,
  /** The same, as a multiple of `createRemoteJWKSet` of jose that holds the same set. Measured 1.79 to 2.63. */
  jwksAgainstRemote: 6,
  /** `publishScore` of a score, as a multiple of `callService` of core sending the same request to the same answer. Measured 3.59 to 4.64. */
  publishScore: 10,
  /** `control` of a request of the Assessment Control Service, as a multiple of `callService` of the same request. Measured 2.15 to 3.21. */
  control: 7,
  /** `registerTool` of a tool's configuration, as a multiple of `callService` of the same request. Measured 4.07 to 5.00. */
  registerTool: 10,
  /** The token endpoint of the platform, as a multiple of `jwtVerify` of jose on the client assertion of the request. Measured 2.49 to 3.02. */
  tokenEndpoint: 7,
  /** The handler of the members of a context, a page of 1,000, as a multiple of `JSON.stringify` of the page. Measured 4.79 to 5.92. */
  membersHandler: 20,
  /** The handler of the results of a line item, a page of 1,000, as a multiple of `JSON.stringify` of the page. Measured 6.96 to 8.05. */
  resultsHandler: 20,
  /** The handler of a score, as a multiple of `compactVerify` of jose on its access token and `JSON.parse` of its body. Measured 2.47 to 3.57. */
  scoreHandler: 8,
  /** The handler of a request of the Assessment Control Service, as a multiple of the same. Measured 2.60 to 3.53. */
  controlHandler: 8,
  /** The handler of a registration, as a multiple of the same and `JSON.stringify` of its answer. Measured 2.57 to 3.52. */
  registrationHandler: 8,
  /** `buildDeepLinkingResponse` with five items, one of each type, as a multiple of `SignJWT` of jose on the same claims. Measured 1.14 to 1.24. */
  deepLinkingResponse: 3,
  /** `readDeepLinkingResponse` of the same, as a multiple of `jwtVerify` of jose on its JWT. Measured 2.99 to 3.52. */
  readDeepLinkingResponse: 8,
  /** `buildStartAssessmentPage`, as a multiple of `SignJWT` of jose on the same claims. Measured 1.07 to 1.15. */
  startAssessment: 3,
  /** `readStartAssessment` of the same, as a multiple of `jwtVerify` of jose on its JWT. Measured 2.39 to 2.67. */
  readStartAssessment: 6,
  /** `handleLaunch` of a message with every claim, as a multiple of `verifyLaunch` of `@lti-tool/core` on the same message. Measured 1.07 to 1.29. */
  launchAgainstLtiTool: 3,
  /** The same, as a multiple of `validate` of `lti-core`. Measured 1.68 to 1.95. */
  launchAgainstLtiCore: 4,
  /** The authorization request that substitutes the 44 variables that the platform supports, as a multiple of the same request with plain values. Measured 0.98 to 1.04. */
  substitution: 3,
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
