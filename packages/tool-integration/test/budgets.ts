import { expect, type TestContext } from "vitest";
import { alternate, reportRatio } from "../../../scripts/bench-rounds.js";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/** The number of members, results and line items of the pages that the benchmarks read and write. */
export const PAGE_SIZE = 1000;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of a reference in the same
 * run: five times the largest ratio measured, rounded up to one significant digit, as docs/tool-integration/evidence.md
 * explains. Both samples come from one run, so a ratio holds on any machine.
 */
export const RATIOS = {
  /** `handleLaunch` with an RS256 `id_token`, as a multiple of `jwtVerify` of jose on the same token. Measured up to 2.40. */
  launchRs256: 20,
  /** `handleLaunch` with an ES256 `id_token`, as a multiple of `jwtVerify` of jose on the same token. Measured up to 2.05. */
  launchEs256: 20,
  /** The authorization request that issues an RS256 `id_token` with every claim, as a multiple of `SignJWT` of jose on the same claims. Measured up to 1.36. */
  authorizeRs256: 7,
  /** The same with ES256. Measured up to 3.91. */
  authorizeEs256: 20,
  /** `members` of a page of 1,000 members, as a multiple of `JSON.parse` of its text. Measured up to 4.03. */
  members: 30,
  /** `results` of a page of 1,000 results, as a multiple of `JSON.parse` of its text. Measured up to 6.49. */
  results: 40,
  /** `lineItems` of a page of 1,000 line items, as a multiple of `JSON.parse` of its text. Measured up to 7.27. */
  lineItems: 40,
  /** The key that the key set cache resolves from a set it holds, as a multiple of `createLocalJWKSet` of jose on the same set. Measured up to 2.72. */
  jwksAgainstLocal: 20,
  /** The same, as a multiple of `createRemoteJWKSet` of jose that holds the same set. Measured up to 2.04. */
  jwksAgainstRemote: 20,
  /** `publishScore` of a score, as a multiple of `callService` of core sending the same request to the same answer. Measured up to 3.61. */
  publishScore: 20,
  /** `control` of a request of the Assessment Control Service, as a multiple of `callService` of the same request. Measured up to 2.64. */
  control: 20,
  /** `registerTool` of a tool's configuration, as a multiple of `callService` of the same request. Measured up to 4.72. */
  registerTool: 30,
  /** The token endpoint of the platform, as a multiple of `jwtVerify` of jose on the client assertion of the request. Measured up to 2.50. */
  tokenEndpoint: 20,
  /** The handler of the members of a context, a page of 1,000, as a multiple of `JSON.stringify` of the page. Measured up to 6.24. */
  membersHandler: 40,
  /** The handler of the results of a line item, a page of 1,000, as a multiple of `JSON.stringify` of the page. Measured up to 8.06. */
  resultsHandler: 50,
  /** The handler of a score, as a multiple of `compactVerify` of jose on its access token and `JSON.parse` of its body. Measured up to 3.10. */
  scoreHandler: 20,
  /** The handler of a request of the Assessment Control Service, as a multiple of the same. Measured up to 3.05. */
  controlHandler: 20,
  /** The handler of a registration, as a multiple of the same and `JSON.stringify` of its answer. Measured up to 3.39. */
  registrationHandler: 20,
  /** `buildDeepLinkingResponse` with five items, one of each type, as a multiple of `SignJWT` of jose on the same claims. Measured up to 1.18. */
  deepLinkingResponse: 6,
  /** `readDeepLinkingResponse` of the same, as a multiple of `jwtVerify` of jose on its JWT. Measured up to 3.25. */
  readDeepLinkingResponse: 20,
  /** `buildStartAssessmentPage`, as a multiple of `SignJWT` of jose on the same claims. Measured up to 1.13. */
  startAssessment: 6,
  /** `readStartAssessment` of the same, as a multiple of `jwtVerify` of jose on its JWT. Measured up to 2.53. */
  readStartAssessment: 20,
  /** `handleLaunch` of a message with every claim, as a multiple of `verifyLaunch` of `@lti-tool/core` on the same message. Measured up to 1.31. */
  launchAgainstLtiTool: 7,
  /** The same, as a multiple of `validate` of `lti-core`. Measured up to 2.06. */
  launchAgainstLtiCore: 20,
  /** The authorization request that substitutes the 44 variables that the platform supports, as a multiple of the same request with plain values. Measured up to 1.00. */
  substitution: 5,
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
