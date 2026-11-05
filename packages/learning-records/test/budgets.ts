import { expect, type TestContext } from "vitest";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
export const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/** The number of Statements of the batch that the benchmarks check and read: the most that an LRS takes in one request. */
export const STATEMENTS = 1000;

/**
 * The most that the fastest sample of a benchmark may take, in milliseconds: five times the fastest of the samples of the
 * runner of CI, rounded up to one significant digit, as docs/learning-records/performance.md explains.
 */
export const BUDGETS = {
  /** `validateStatement` of each of the Statements of the batch. */
  validateStatement: 70,
  /** `parseStatementJson` of the text of the batch. */
  parseStatementJson: 40,
} as const;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of a reference in the same run.
 * Both samples come from one run, so a ratio holds on any machine. A ratio is twice the highest ratio measured on the runner of CI in 12 runs of the bench job on 2026-11-04 and 2026-11-05, rounded up to one significant digit,
 * as docs/learning-records/performance.md explains.
 */
export const RATIOS = {
  /** `validateStatement` of the Statements of the batch, as a multiple of the validator of Learning Locker on the same Statements. */
  validateAgainstLearningLocker: 2,
  /** `parseStatementJson` of the text of the batch, as a multiple of `JSON.parse` of it. */
  parseJsonAgainstParse: 7,
  /** `readStatement` of each Statement of the batch, as a multiple of the validator of Learning Locker. */
  readAgainstLearningLocker: 2,
  /** `validateStatements` of the batch as a whole, as a multiple of the validator of Learning Locker. */
  validateBatchAgainstLearningLocker: 2,
  /** `buildStatement` of each Statement of the batch, as a multiple of the validator of Learning Locker on them. */
  buildAgainstLearningLocker: 2,
  /** `mboxSha1sum` of 1,000 mailto IRIs, as a multiple of the SHA-1 of node:crypto on them. */
  mboxSha1sumAgainstNative: 5,
  /** `deriveStatementId` of 1,000 names, as a multiple of the SHA-1 of node:crypto on 1,000 mailto IRIs. */
  deriveIdAgainstNative: 20,
  /** `isSameStatement` of each Statement of the batch and its copy, as a multiple of the validator of Learning Locker on them. */
  sameStatementAgainstLearningLocker: 5,
  /** `convertStatementVersion` of each Statement of the batch, as a multiple of the validator of Learning Locker on them. */
  toVersionAgainstLearningLocker: 2,
  /** `formatStatement` of each Statement of the batch, in `ids` and in `canonical`, as a multiple of the same. */
  formatAgainstLearningLocker: 2,
  /** `readMultipart` of 99 Statements with 6.2 MiB of data, as a multiple of the parser and the SHA-256 of node:crypto. */
  readMultipartAgainstNative: 20,
  /** `writeMultipart` of the same, as a multiple of their JSON, the SHA-256 of node:crypto and a copy of the bytes. */
  writeMultipartAgainstNative: 20,
  /** `hashAttachment` of 1 MiB, as a multiple of the SHA-256 of node:crypto. */
  attachmentHashAgainstNative: 20,
  /** `signStatement` with an RSA key of 2,048 bits, as a multiple of the `CompactSign` of jose of the same payload. */
  signAgainstJose: 3,
  /** `verifyStatementSignature` of the same, as a multiple of the `compactVerify` of jose. */
  verifyAgainstJose: 8,
  /** `handleLrsRequest` of a POST of the batch, as a multiple of the validator of Learning Locker on it. */
  postAgainstLearningLocker: 3,
  /** `handleLrsRequest` of a GET of a page of 100 Statements, as a multiple of `JSON.stringify` of the page. */
  getAgainstStringify: 3,
  /** `matchesStatementQuery` over the batch, as a multiple of the validator of Learning Locker on it. */
  matchAgainstLearningLocker: 0.2,
  /** `validateProfile` of the text of a profile of 907 concepts, as a multiple of `JSON.parse` of the text. */
  validateProfileAgainstParse: 30,
  /**
   * `validateProfile` of the texts of a profile whose alternates name 40,000 Patterns and that revises 40,000 concepts of another,
   * as a multiple of `JSON.parse` of the two texts.
   */
  wideProfileAgainstParse: 30,
  /** `validateStatement` of a validator of a profile on each Statement of a relay, as a multiple of `readStatement` of each. */
  templatesAgainstRead: 3,
  /** `validateStatements` of a validator of a profile on the relay, as a multiple of `readStatement` of each Statement. */
  patternsAgainstRead: 4,
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
