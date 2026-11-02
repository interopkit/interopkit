import { expect, type TestContext } from "vitest";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
export const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/** The number of members, and of results, of the page that the benchmarks read. */
export const PAGE_SIZE = 1000;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of a reference in the same
 * run: five times the largest ratio measured, rounded up to one significant digit, as docs/tool-integration/evidence.md
 * explains. Both samples come from one run, so a ratio holds on any machine.
 */
export const RATIOS = {
  /** `ltiLaunch` with an RS256 `id_token`, as a multiple of `jwtVerify` of jose on the same token. Measured up to 2.93. */
  launchRs256: 20,
  /** `ltiLaunch` with an ES256 `id_token`, as a multiple of `jwtVerify` of jose on the same token. Measured up to 1.95. */
  launchEs256: 10,
  /** The authorization request that issues an RS256 `id_token` with every claim, as a multiple of `SignJWT` of jose on the same claims. Measured up to 1.36. */
  authorizeRs256: 7,
  /** The same with ES256. Measured up to 3.44. */
  authorizeEs256: 20,
  /** `members` of a page of 1,000 members, as a multiple of `JSON.parse` of its text. Measured up to 4.03. */
  members: 30,
  /** `results` of a page of 1,000 results, as a multiple of `JSON.parse` of its text. Measured up to 7.91. */
  results: 40,
  /** The authorization request that substitutes the 44 variables that the platform supports, as a multiple of the same request with plain values. Measured up to 1.00. */
  substitution: 5,
} as const;

/** The result of a benchmark that the budgets read. */
interface BenchResult {
  readonly latency: { readonly min: number; readonly p50: number };
}

/**
 * Reports the fastest and the median sample of a benchmark and of its reference, and fails the test when the fastest sample is
 * above its ratio to the reference's. The fastest sample is the least affected by the other work of a shared machine.
 */
export async function expectRatio(
  annotate: TestContext["annotate"],
  name: keyof typeof RATIOS,
  measured: BenchResult,
  reference: BenchResult & { readonly name: string },
): Promise<void> {
  const ratio = measured.latency.min / reference.latency.min;
  await annotate(
    `${name}: fastest ${measured.latency.min.toFixed(3)} ms, median ${measured.latency.p50.toFixed(3)} ms; ${reference.name}: fastest ${reference.latency.min.toFixed(3)} ms; ${ratio.toFixed(2)} times that, budget ${RATIOS[name]}`,
  );
  expect(ratio, `The fastest sample of ${name} as a multiple of the fastest sample of ${reference.name}`).toBeLessThan(
    RATIOS[name],
  );
}
