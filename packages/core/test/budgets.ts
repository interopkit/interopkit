import { expect, type TestContext } from "vitest";
import { alternate as alternateRounds, reportRatio, type Sides } from "../../../scripts/bench-rounds.js";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
const BENCH_OPTIONS = { time: 1000, iterations: 20, warmupTime: 200, warmupIterations: 5 } as const;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of its reference in the same
 * run: 1.5 times the highest ratio measured on the runner of CI and on a laptop, rounded up to two significant digits. The
 * reference is the least work of the same kind, the platform API that the function wraps, since no library does what `core`
 * does. Both samples come from one run, so a ratio holds on any machine.
 */
export const RATIOS = {
  /** `get` of each of 1,000 kept keys of `createKeyedCache`, against a `Map` with an expiry. Measured 1.08 to 1.21. */
  keyedCacheHit: 1.9,
  /** `get` of one key by 100 callers while it loads once, against 100 waits on one promise. Measured 1.66 to 2.00. */
  keyedCacheShared: 3.1,
  /** `readJson` of a body of 1 MiB, against `TextDecoder` and `JSON.parse`. Measured 1.47 to 1.68. */
  readJson: 2.6,
  /** `readForm` of 2,000 parameters, against `URLSearchParams`. Measured 0.96 to 1.00. */
  readForm: 1.6,
  /** `requestService` of an answer of 1 MiB in chunks of 16 KiB, against `Response.arrayBuffer`. Measured 0.94 to 1.15. */
  requestService: 1.8,
  /** `signCompactJws` with EdDSA, against `crypto.subtle.sign` of its signing input. Measured 1.15 to 1.21. */
  signCompactJws: 1.9,
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
