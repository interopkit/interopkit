import { expect, type TestContext } from "vitest";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
export const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/** The number of items of the framework that the benchmarks read, and of the documents that they query. */
export const ITEMS = 10_000;

/**
 * The budgets of the benchmarks. A time is the most that the fastest sample of a benchmark may take, in milliseconds: five
 * times the fastest sample of the runner of CI, rounded up to one significant digit, as docs/competency-frameworks/evidence.md
 * explains.
 */
export const BUDGETS = {
  /** `readPackage` of a framework of 10,000 items that is already parsed. */
  readPackage: 400,
  /** `validatePackage` of the same framework. */
  validatePackage: 400,
  /** `frameworkTree` of the same framework. */
  frameworkTree: 300,
  /** `queryEntities` with a filter and a sort over 10,000 documents. */
  queryDocuments: 40,
} as const;

/**
 * The run options of a reference that takes seconds for the batch: three samples after one warm-up. The official schemas take
 * about a second for the framework, so twenty samples would take minutes. The fastest of three samples is the one the budget reads.
 */
export const SLOW_REFERENCE_OPTIONS = { time: 0, iterations: 3, warmupTime: 0, warmupIterations: 1 } as const;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of a reference in the same run.
 * Both samples come from one run, so a ratio holds on any machine. A ratio to `JSON.parse` or `JSON.stringify` is five times the
 * highest ratio measured, rounded up to one significant digit, and a ratio to an official schema is parity, as
 * docs/competency-frameworks/evidence.md explains.
 */
export const RATIOS = {
  /** `readPackage` of the framework, as a multiple of `JSON.parse` of its text. */
  readPackageAgainstParse: 20,
  /** `readPackage` of the framework, as a multiple of the package schema of CASE 1.1: parity or better. */
  readPackageAgainstSchema: 1,
  /** `readEntity` of each item alone, as a multiple of the item schema of CASE 1.1: parity or better. */
  readEntityAgainstSchema: 1,
  /** `frameworkTree` of the framework, as a multiple of `JSON.parse` of its text. */
  frameworkTreeAgainstParse: 20,
  /** `toCaseVersion` of the framework to 1.0, as a multiple of `JSON.parse` of its text. */
  toCaseVersionAgainstParse: 20,
  /** `diffPackages` of the framework and an edition of it, as a multiple of `JSON.parse` of its text. */
  diffPackagesAgainstParse: 20,
  /** `crosswalk` of the framework and the one it matches, as a multiple of `JSON.parse` of its text. */
  crosswalkAgainstParse: 7,
  /** `associationsOf` an item of the framework, as a multiple of `JSON.parse` of its text. */
  associationsOfAgainstParse: 4,
  /** `handleCaseRequest` for the package of the framework in 1.1, as a multiple of `JSON.stringify` of it. */
  serve11AgainstStringify: 6,
  /** `handleCaseRequest` for the package of the framework in 1.0, which converts it, as a multiple of `JSON.stringify` of it. */
  serve10AgainstStringify: 60,
  /** `package` of a client over the answer of the provider, as a multiple of `JSON.parse` of its text. */
  clientAgainstParse: 50,
} as const;

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

/**
 * Reports the fastest sample of two functions and their ratio, and fails the test when the ratio is above the budget. The fastest
 * sample is the least affected by the other work of a shared machine.
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
    `${name}: fastest ${measured.latency.min.toFixed(2)} ms; ${reference.name}: fastest ${reference.latency.min.toFixed(2)} ms; ratio ${ratio.toFixed(3)}, budget ${budget}`,
  );
  expect(
    ratio,
    `The fastest sample of "${name}" as a multiple of the fastest sample of ${reference.name}`,
  ).toBeLessThan(budget);
}
