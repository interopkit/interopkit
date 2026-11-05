import { expect, type TestContext } from "vitest";
import { alternate as alternateRounds, reportRatio, type Sides } from "../../../scripts/bench-rounds.js";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
const BENCH_OPTIONS = { time: 1000, iterations: 20, warmupTime: 200, warmupIterations: 5 } as const;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of its reference in the same
 * run: twice the highest ratio measured on the runner of CI in 12 runs of the bench job on 2026-11-04 and 2026-11-05, rounded up to one significant digit. The
 * reference is the least work of the same kind, the platform API that the function wraps, since no library does what `core`
 * does. Both samples come from one run, so a ratio holds on any machine.
 */
export const RATIOS = {
  /** `get` of each of 1,000 kept keys of `createKeyedCache`, against a `Map` with an expiry. Measured 1.10 to 1.22. */
  keyedCacheHit: 3,
  /** `get` of one key by 100 callers while it loads once, against 100 waits on one promise. Measured 1.70 to 1.86. */
  keyedCacheShared: 4,
  /** `readJson` of a body of 1 MiB, against `TextDecoder` and `JSON.parse`. Measured 1.22 to 1.59. */
  readJson: 4,
  /** `readForm` of 2,000 parameters, against `URLSearchParams`. Measured 0.94 to 1.02. */
  readForm: 3,
  /** `requestService` of an answer of 1 MiB in chunks of 16 KiB, against `Response.arrayBuffer`. Measured 0.93 to 1.12. */
  requestService: 3,
  /** `signCompactJws` with EdDSA, against `crypto.subtle.sign` of its signing input. Measured 1.16 to 1.23. */
  signCompactJws: 3,
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
