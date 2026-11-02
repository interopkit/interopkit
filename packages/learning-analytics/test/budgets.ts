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
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of a reference in the same run.
 * Both samples come from one run, so a ratio holds on any machine. A ratio to `JSON.parse` or `JSON.stringify` is five times the highest ratio
 * measured, rounded up to one significant digit, and a ratio to a draft 4 validator is parity, as docs/learning-analytics/evidence.md
 * explains. The budgets in time are pending the first sample of the runners of CI, so none is stated here.
 */
export const RATIOS = {
  /** `readEnvelope` of an envelope of 1.2, as a multiple of `JSON.parse` of its text. */
  readEnvelopeAgainstParse: 30,
  /** `readEnvelope` of an envelope of 1.2, as a multiple of the draft 4 schemas of `caliper-spec` over its events: parity or better. */
  readEnvelopeAgainstSchemas: 1,
  /** `validateEvent` over the events of an envelope of 1.2, as a multiple of the same schemas: parity or better. */
  validateEventAgainstSchemas: 1,
  /** `readEnvelope` of an envelope of 1.1, as a multiple of `JSON.parse` of its text. */
  readEnvelope11AgainstParse: 30,
  /** `readEnvelope` of an envelope of 1.1, as a multiple of `schema_1_1` over its events: parity or better. */
  readEnvelope11AgainstSchemas: 1,
  /** `readEntity` of 1,000 entity describes of 1.2, as a multiple of the draft 4 schemas over them: parity or better. */
  readEntityAgainstSchemas: 1,
  /** `validateEntity` over the same, as a multiple of the same schemas: parity or better. */
  validateEntityAgainstSchemas: 1,
  /** `buildEvent` of 1,000 events, as a multiple of the draft 4 schemas over what it builds: parity or better. */
  buildEventAgainstSchemas: 1,
  /** `buildEntity` of 1,000 entity describes, as a multiple of the same schemas over what it builds: parity or better. */
  buildEntityAgainstSchemas: 1,
  /** `sendCaliper` of an envelope of 1,000 events to an endpoint that answers at once, as a multiple of `JSON.stringify` of it. */
  sendCaliperAgainstStringify: 7,
  /** `handleCaliperRequest` of an envelope of 1,000 events of 1.2, as a multiple of `JSON.parse` of its text. */
  handleRequestAgainstParse: 50,
  /** `handleCaliperRequest` of the same envelope, as a multiple of the draft 4 schemas over its events: parity or better. */
  handleRequestAgainstSchemas: 1,
} as const;

/** The result of a benchmark that the budgets read. */
interface BenchResult {
  readonly latency: { readonly min: number; readonly p50: number };
}

/**
 * Reports the fastest and the median sample of a function and of its reference, and fails the test when the fastest sample of the
 * function is above its ratio to the reference's. The fastest sample is the least affected by the other work of a shared machine.
 */
export async function expectRatio(
  annotate: TestContext["annotate"],
  name: keyof typeof RATIOS,
  measured: BenchResult,
  reference: BenchResult & { readonly name: string },
): Promise<void> {
  const ratio = measured.latency.min / reference.latency.min;
  await annotate(
    `${name}: fastest ${measured.latency.min.toFixed(2)} ms, median ${measured.latency.p50.toFixed(2)} ms; ${reference.name}: fastest ${reference.latency.min.toFixed(2)} ms, median ${reference.latency.p50.toFixed(2)} ms; ratio ${ratio.toFixed(3)}, budget ${RATIOS[name]}`,
  );
  expect(ratio, `The fastest sample of ${name} as a multiple of the fastest sample of ${reference.name}`).toBeLessThan(
    RATIOS[name],
  );
}
