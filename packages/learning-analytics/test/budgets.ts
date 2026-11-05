import { expect, type TestContext } from "vitest";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
export const BENCH_OPTIONS = { time: 1000, iterations: 20, warmupTime: 200, warmupIterations: 5 } as const;

/**
 * The run options of a reference that takes seconds for the batch: three samples after one warm-up. The draft 4 schemas of 1.1
 * take about 90 ms for one `Message` event, because their `oneOf` of every class is tried in turn at each level, so twenty
 * samples of a batch would take minutes. The fastest of three samples is the one the budget reads.
 */
export const SLOW_REFERENCE_OPTIONS = { time: 0, iterations: 3, warmupTime: 0, warmupIterations: 1 } as const;

/** The number of events of the batch that the benchmarks read and check: an envelope of that many events. */
export const EVENTS = 1000;

/**
 * The budgets of the benchmarks. The time is the most that the fastest sample of a function may take, in milliseconds: five
 * times its fastest sample on the runner of CI, rounded up to one significant digit. The ratio is the most that it may take
 * as a multiple of the fastest sample of a reference in the same run, so it holds on any machine: twice the highest ratio measured on the runner of CI in 12 runs of the bench job on 2026-11-04 and 2026-11-05, rounded up to one significant digit, as
 * docs/learning-analytics/performance.md explains.
 */
export const BUDGETS = {
  /** `readEnvelope` of an envelope of 1.2, as a multiple of `JSON.parse` of its text. */
  readEnvelopeAgainstParse: { time: 200, ratio: 20 },
  /** `readEnvelope` of an envelope of 1.2, as a multiple of the draft 4 schemas of `caliper-spec` over its events. */
  readEnvelopeAgainstSchemas: { time: 200, ratio: 0.09 },
  /** `validateEvent` over the events of an envelope of 1.2, as a multiple of the same schemas. */
  validateEventAgainstSchemas: { time: 200, ratio: 0.09 },
  /** `readEnvelope` of an envelope of 1.1, as a multiple of `JSON.parse` of its text. */
  readEnvelope11AgainstParse: { time: 200, ratio: 20 },
  /** `readEnvelope` of an envelope of 1.1, as a multiple of `schema_1_1` over its events. */
  readEnvelope11AgainstSchemas: { time: 200, ratio: 0.007 },
  /** `readEntity` of 1,000 entity describes of 1.2, as a multiple of the draft 4 schemas over them. */
  readEntityAgainstSchemas: { time: 40, ratio: 0.2 },
  /** `validateEntity` over the same, as a multiple of the same schemas. */
  validateEntityAgainstSchemas: { time: 50, ratio: 0.2 },
  /** `buildEvent` of 1,000 events, as a multiple of the draft 4 schemas over what it builds. */
  buildEventAgainstSchemas: { time: 200, ratio: 0.09 },
  /** `buildEntity` of 1,000 entity describes, as a multiple of the same schemas over what it builds. */
  buildEntityAgainstSchemas: { time: 50, ratio: 0.2 },
  /** `sendCaliper` of an envelope of 1,000 events to an endpoint that answers at once, as a multiple of `JSON.stringify` of it. */
  sendCaliperAgainstStringify: { time: 30, ratio: 5 },
  /** `handleCaliperRequest` of an envelope of 1,000 events of 1.2, as a multiple of `JSON.parse` of its text. */
  handleRequestAgainstParse: { time: 200, ratio: 20 },
  /** `handleCaliperRequest` of the same envelope, as a multiple of the draft 4 schemas over its events. */
  handleRequestAgainstSchemas: { time: 200, ratio: 0.1 },
} as const;

/** The result of a benchmark that the budgets read. */
interface BenchResult {
  readonly latency: { readonly min: number; readonly p50: number };
}

/**
 * Reports the fastest and the median sample of a function and of its reference, and fails the test when the fastest sample of the
 * function is above its time or above its ratio to the reference's. The fastest sample is the least affected by the other work of
 * a shared machine.
 */
export async function expectRatio(
  annotate: TestContext["annotate"],
  name: keyof typeof BUDGETS,
  measured: BenchResult,
  reference: BenchResult & { readonly name: string },
): Promise<void> {
  const { time, ratio: limit } = BUDGETS[name];
  const ratio = measured.latency.min / reference.latency.min;
  await annotate(
    `${name}: fastest ${measured.latency.min.toFixed(2)} ms, median ${measured.latency.p50.toFixed(2)} ms; ${reference.name}: fastest ${reference.latency.min.toFixed(2)} ms, median ${reference.latency.p50.toFixed(2)} ms; ratio ${ratio.toFixed(3)}, budget ${limit}; time budget ${time} ms`,
  );
  expect(measured.latency.min, `The fastest sample of ${name} in milliseconds`).toBeLessThan(time);
  expect(ratio, `The fastest sample of ${name} as a multiple of the fastest sample of ${reference.name}`).toBeLessThan(
    limit,
  );
}
