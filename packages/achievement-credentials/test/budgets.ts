import { expect, type TestContext } from "vitest";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
export const BENCH_OPTIONS = { time: 1000, iterations: 20, warmupTime: 200, warmupIterations: 5 } as const;

/**
 * The most that the fastest sample of `verifyCredential` may take as a multiple of the fastest sample of the library that is
 * its reference in the same run: five times the measured ratio, rounded up to one significant digit, as
 * docs/achievement-credentials/evidence.md explains. Both samples come from one run, so a ratio holds on any machine. The
 * budgets in time wait for samples of the runner of CI.
 */
export const RATIOS = {
  /**
   * Against `did-jwt-vc`, which checks the signature and the format of the claims, and nothing of the issuer or the status.
   * Measured 0.13 to 0.15 in five runs.
   */
  jwt: 0.8,
  /** Against Digital Bazaar's `vc`, which checks the structure of the credential and the proof. Measured 1.04 to 1.10 in five runs. */
  dataIntegrity: 6,
} as const;

/** The result of a benchmark that the budgets read. */
interface BenchResult {
  readonly latency: { readonly min: number; readonly p50: number };
}

/**
 * Reports the fastest and the median sample of `verifyCredential` and of its reference, and fails the test when the fastest
 * sample of `verifyCredential` is above its ratio to the reference's. The fastest sample is the least affected by the other
 * work of a shared machine.
 */
export async function expectRatioWithin(
  annotate: TestContext["annotate"],
  name: keyof typeof RATIOS,
  reference: string,
  result: BenchResult,
  theirs: BenchResult,
): Promise<void> {
  const measured = result.latency.min / theirs.latency.min;
  await annotate(
    `${name}: fastest ${result.latency.min.toFixed(2)} ms, median ${result.latency.p50.toFixed(2)} ms; ${reference}: fastest ${theirs.latency.min.toFixed(2)} ms, median ${theirs.latency.p50.toFixed(2)} ms; ${measured.toFixed(2)} times that, budget ${RATIOS[name]}`,
  );
  expect(measured, `The fastest sample of ${name} as a multiple of ${reference}`).toBeLessThan(RATIOS[name]);
}
