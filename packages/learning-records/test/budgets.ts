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
  validateStatement: 200,
  /** `parseStatementJson` of the text of the batch. */
  parseStatementJson: 70,
} as const;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of a reference in the same run.
 * Both samples come from one run, so a ratio holds on any machine. A ratio is five times the highest ratio measured on the runner of CI and on a laptop, rounded up to one significant digit,
 * as docs/learning-records/performance.md explains, except a ratio of a reader to the validator of Learning
 * Locker, which does the same work and whose budget is parity.
 */
export const RATIOS = {
  /** `validateStatement` of the Statements of the batch, as a multiple of the validator of Learning Locker on the same Statements: parity or better. */
  validateAgainstLearningLocker: 1,
  /** `parseStatementJson` of the text of the batch, as a multiple of `JSON.parse` of it. */
  parseJsonAgainstParse: 20,
  /** `readStatement` of each Statement of the batch, as a multiple of the validator of Learning Locker: parity or better. */
  readAgainstLearningLocker: 1,
  /** `validateStatements` of the batch as a whole, as a multiple of the validator of Learning Locker: parity or better. */
  validateBatchAgainstLearningLocker: 1,
  /** `buildStatement` of each Statement of the batch, as a multiple of the validator of Learning Locker on them. */
  buildAgainstLearningLocker: 4,
  /** `mboxSha1sum` of 1,000 mailto IRIs, as a multiple of the SHA-1 of node:crypto on them. */
  mboxSha1sumAgainstNative: 20,
  /** `deriveStatementId` of 1,000 names, as a multiple of the SHA-1 of node:crypto on 1,000 mailto IRIs. */
  deriveIdAgainstNative: 40,
  /** `isSameStatement` of each Statement of the batch and its copy, as a multiple of the validator of Learning Locker on them. */
  sameStatementAgainstLearningLocker: 20,
  /** `convertStatementVersion` of each Statement of the batch, as a multiple of the validator of Learning Locker on them. */
  toVersionAgainstLearningLocker: 4,
  /** `formatStatement` of each Statement of the batch, in `ids` and in `canonical`, as a multiple of the same. */
  formatAgainstLearningLocker: 4,
  /** `readMultipart` of 99 Statements with 6.2 MiB of data, as a multiple of the parser and the SHA-256 of node:crypto. */
  readMultipartAgainstNative: 60,
  /** `writeMultipart` of the same, as a multiple of their JSON, the SHA-256 of node:crypto and a copy of the bytes. */
  writeMultipartAgainstNative: 70,
  /** `hashAttachment` of 1 MiB, as a multiple of the SHA-256 of node:crypto. */
  attachmentHashAgainstNative: 80,
  /** `signStatement` with an RSA key of 2,048 bits, as a multiple of the `CompactSign` of jose of the same payload. */
  signAgainstJose: 7,
  /** `verifyStatementSignature` of the same, as a multiple of the `compactVerify` of jose. */
  verifyAgainstJose: 30,
  /** `handleLrsRequest` of a POST of the batch, as a multiple of the validator of Learning Locker on it. */
  postAgainstLearningLocker: 7,
  /** `handleLrsRequest` of a GET of a page of 100 Statements, as a multiple of `JSON.stringify` of the page. */
  getAgainstStringify: 8,
  /** `matchesStatementQuery` over the batch, as a multiple of the validator of Learning Locker on it. */
  matchAgainstLearningLocker: 0.5,
  /** `validateProfile` of the text of a profile of 907 concepts, as a multiple of `JSON.parse` of the text. */
  validateProfileAgainstParse: 50,
  /**
   * `validateProfile` of the texts of a profile whose alternates name 40,000 Patterns and that revises 40,000 concepts of another,
   * as a multiple of `JSON.parse` of the two texts.
   */
  wideProfileAgainstParse: 50,
  /** `validateStatement` of a validator of a profile on each Statement of a relay, as a multiple of `readStatement` of each. */
  templatesAgainstRead: 6,
  /** `validateStatements` of a validator of a profile on the relay, as a multiple of `readStatement` of each Statement. */
  patternsAgainstRead: 8,
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
