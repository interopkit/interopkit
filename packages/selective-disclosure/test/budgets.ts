import { expect, type TestContext } from "vitest";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
export const BENCH_OPTIONS = { time: 1000, iterations: 20, warmupTime: 200, warmupIterations: 5 } as const;

/**
 * The most that the fastest sample of each role may take as a multiple of the fastest sample of Digital Bazaar's suite in the
 * same run: five times the measured ratio, rounded up to one significant digit, as docs/selective-disclosure/proofs.md
 * explains. Both samples come from one run, so a ratio holds on any machine.
 */
export const RATIOS = {
  /** Measured 1.06. */
  addBaseProof: 6,
  /** Measured 1.10. */
  deriveProof: 6,
  /** Measured 0.95. */
  verify: 5,
} as const;

/** The result of a benchmark that the budgets read. */
interface BenchResult {
  readonly latency: { readonly min: number; readonly p50: number };
}

/**
 * Reports the fastest and the median sample of a role and of Digital Bazaar's suite, and fails the test when the fastest
 * sample of the role is above its ratio to the reference's. The fastest sample is the least affected by the other work of a
 * shared machine.
 */
export async function expectRatioWithin(
  annotate: TestContext["annotate"],
  name: keyof typeof RATIOS,
  result: BenchResult,
  reference: BenchResult,
): Promise<void> {
  const measured = result.latency.min / reference.latency.min;
  await annotate(
    `${name}: fastest ${result.latency.min.toFixed(2)} ms, median ${result.latency.p50.toFixed(2)} ms; Digital Bazaar's suite: fastest ${reference.latency.min.toFixed(2)} ms, median ${reference.latency.p50.toFixed(2)} ms; ${measured.toFixed(2)} times that, budget ${RATIOS[name]}`,
  );
  expect(measured, `The fastest sample of ${name} as a multiple of Digital Bazaar's`).toBeLessThan(RATIOS[name]);
}
