import { expect, type TestContext } from "vitest";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
export const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/** The number of Statements of the batch that the benchmarks check and read: the most that an LRS takes in one request. */
export const STATEMENTS = 1000;

/**
 * The most that the fastest sample of a benchmark may take, in milliseconds: five times the fastest of the samples of the runner
 * of CI, rounded up to one significant digit, as docs/learning-records/evidence.md explains.
 */
export const BUDGETS = {
  /** `validateStatement` of each of the Statements of the batch. */
  validateStatement: 100,
  /** `readStatementJson` of the text of the batch. */
  readStatementJson: 500,
} as const;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of a reference in the same run.
 * Both samples come from one run, so a ratio holds on any machine. A ratio is five times the measured one, rounded up to one
 * significant digit, as docs/learning-records/evidence.md explains, except the ratio to Learning Locker, which is parity.
 */
export const RATIOS = {
  /** `validateStatement` of the Statements of the batch, as a multiple of the validator of Learning Locker on the same Statements: parity or better. */
  validateAgainstLearningLocker: 1,
  /** `readStatementJson` of the text of the batch, as a multiple of `JSON.parse` of it. */
  readJsonAgainstParse: 40,
} as const;

/**
 * Reports the median and the fastest sample of a benchmark with its budget, and fails the test when the fastest sample is above
 * the budget. The fastest sample is the least affected by the other work of a shared machine.
 */
export async function expectWithin(
  annotate: TestContext["annotate"],
  name: string,
  result: { readonly latency: { readonly min: number; readonly p50: number } },
  budget: number,
): Promise<void> {
  const { min, p50 } = result.latency;
  await annotate(`${name}: fastest ${min.toFixed(2)} ms, median ${p50.toFixed(2)} ms, budget ${budget} ms`);
  expect(min, `The fastest sample of "${name}" in milliseconds`).toBeLessThan(budget);
}

/**
 * Reports the fastest sample of two functions and their ratio, and fails the test when the ratio is above the budget. The
 * fastest sample is the least affected by the other work of a shared machine.
 */
export async function expectRatio(
  annotate: TestContext["annotate"],
  name: string,
  measured: { readonly latency: { readonly min: number } },
  reference: { readonly name: string; readonly latency: { readonly min: number } },
  budget: number,
): Promise<void> {
  const ratio = measured.latency.min / reference.latency.min;
  await annotate(
    `${name}: fastest ${measured.latency.min.toFixed(2)} ms; ${reference.name}: fastest ${reference.latency.min.toFixed(2)} ms; ratio ${ratio.toFixed(2)}, budget ${budget}`,
  );
  expect(
    ratio,
    `The fastest sample of "${name}" as a multiple of the fastest sample of ${reference.name}`,
  ).toBeLessThan(budget);
}
