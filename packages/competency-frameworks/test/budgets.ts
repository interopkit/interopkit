import { expect, type TestContext } from "vitest";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
export const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/** The number of items of the framework that the benchmarks read, and of the documents that they query. */
export const ITEMS = 10_000;

/**
 * The budgets of the benchmarks. A time is the most that the fastest sample of a benchmark may take, in milliseconds: five
 * times the fastest sample of the machine class it was measured on, rounded up to one significant digit, as
 * docs/competency-frameworks/evidence.md explains.
 */
export const BUDGETS = {
  /** `readPackage` of a framework of 10,000 items that is already parsed. */
  readPackage: 200,
  /** `validatePackage` of the same framework. */
  validatePackage: 200,
  /** `frameworkTree` of the same framework. */
  frameworkTree: 100,
  /** `queryEntities` with a filter and a sort over 10,000 documents. */
  queryDocuments: 20,
} as const;

/**
 * The most that the fastest sample of `readPackage` may take as a multiple of the fastest sample of `JSON.parse` of the same
 * framework in the same run: five times the measured ratio of 4.1, rounded up to one significant digit. Both samples come
 * from one run, so the ratio holds on any machine.
 */
export const READ_RATIO = 30;

/**
 * Reports the median and the fastest sample of a benchmark with its budget, and fails the test when the fastest sample is
 * above the budget. The fastest sample is the least affected by the other work of a shared machine.
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
