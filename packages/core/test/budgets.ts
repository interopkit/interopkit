import { expect, type TestContext } from "vitest";
import { alternate as alternateRounds, reportRatio, type Sides } from "../../../scripts/bench-rounds.js";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
const BENCH_OPTIONS = { time: 1000, iterations: 20, warmupTime: 200, warmupIterations: 5 } as const;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of its reference in the same
 * run: five times the highest ratio of three runs, rounded up to one significant digit. The reference is the least work of the
 * same kind, the platform API that the function wraps, since no library does what `core` does. Both samples come from one run,
 * so a ratio holds on any machine. The budgets in time wait for samples of the runner of CI.
 */
export const RATIOS = {
  /** `get` of each of 1,000 kept keys of `createKeyedCache`, against a `Map` with an expiry. Measured 1.06 to 1.17. */
  keyedCacheHit: 6,
  /** `get` of one key by 100 callers while it loads once, against 100 waits on one promise. Measured 0.71 to 1.33. */
  keyedCacheShared: 7,
  /** `readJson` of a body of 1 MiB, against `TextDecoder` and `JSON.parse`. Measured 1.81 to 1.84. */
  readJson: 10,
  /** `readForm` of 2,000 parameters, against `URLSearchParams`. Measured 0.86 to 0.90. */
  readForm: 5,
  /** `requestService` of an answer of 1 MiB in chunks of 16 KiB, against `Response.arrayBuffer`. Measured 1.02 to 1.14. */
  requestService: 6,
  /** `signCompactJws` with EdDSA, against `crypto.subtle.sign` of its signing input. Measured 1.07 to 1.17. */
  signCompactJws: 6,
} as const;

/**
 * Reports the fastest and the median sample of a function and of its reference, and fails the test when the fastest sample of
 * the function is above its ratio to the reference's.
 */
export async function expectRatioWithin(
  annotate: TestContext["annotate"],
  name: keyof typeof RATIOS,
  reference: string,
  sides: Sides,
): Promise<void> {
  const ratio = await reportRatio(annotate, name, reference, sides, RATIOS[name]);
  expect(ratio, `The fastest sample of ${name} as a multiple of ${reference}`).toBeLessThan(RATIOS[name]);
}

/** Times a function and its reference in turns, with the run options of the package. */
export function alternate(
  bench: TestContext["bench"],
  name: string,
  ours: () => unknown,
  reference: { readonly name: string; readonly run: () => unknown },
): Promise<Sides> {
  return alternateRounds(bench, name, ours, reference, BENCH_OPTIONS);
}
