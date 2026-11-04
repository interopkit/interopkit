import { expect, type TestContext } from "vitest";
import { alternate, reportRatio } from "../../../scripts/bench-rounds.js";

/** The run options of a benchmark: the time and the number of samples of tinybench, and its warm-up. */
export interface BenchOptions {
  readonly time: number;
  readonly iterations: number;
  readonly warmupTime: number;
  readonly warmupIterations: number;
}

/** The run options of every benchmark whose sample takes well under a second. */
const BENCH_OPTIONS: BenchOptions = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 };

/**
 * The run options of a benchmark whose sample takes most of a second on a runner of CI, such as reading 66,001 entries: three
 * samples a round and one to warm up, so that the six rounds of `alternate` end well within the limit of the test, and the
 * fastest of the nine samples of each side still gives the ratio.
 */
export const HEAVY_BENCH_OPTIONS: BenchOptions = { time: 0, iterations: 3, warmupTime: 0, warmupIterations: 1 };

/**
 * The budgets of the benchmarks. The time is the most that the fastest sample of a function may take, in milliseconds: five
 * times its fastest sample on the runner of CI, rounded up to one significant digit. The ratio is the most that it may take
 * as a multiple of the fastest sample of a reference in the same run, so it holds on any machine: five times the highest
 * ratio measured on the runner and on a laptop, rounded up to one significant digit, as docs/course-launch/evidence.md
 * explains.
 */
export const BUDGETS = {
  /**
   * `readCourseStructure` of LMS suite 101 (1,001 units), as a multiple of libxml2 validating it. Measured 3.35 to 4.85: saxes, a
   * parser in JavaScript, takes 2.0 times libxml2 in WebAssembly to parse the text alone, and the reader builds the model and
   * checks the rules of cmi5 that the schema leaves out.
   */
  structureAgainstLibxml2: { time: 300, ratio: 30 },
  /** The same, as a multiple of saxes parsing it alone: the work of the reader beyond the parser. Measured 1.76 to 1.92. */
  structureAgainstSaxes: { time: 400, ratio: 10 },
  /** `readCoursePackage` of a ZIP64 archive of 66,001 entries, as a multiple of zip.js listing its entries. Measured 0.70 to 0.79. */
  packageAgainstEntries: { time: 5000, ratio: 4 },
  /** The LRS of cmi5 judging the seven statements of a session, as a multiple of `validateStatements` of them. Measured 0.83 to 1.24. */
  sessionAgainstValidate: { time: 0.5, ratio: 7 },
  /** The LRS of cmi5 judging 1,000 allowed statements of one request, as a multiple of `validateStatements` of them. Measured 0.32 to 0.47. */
  batchAgainstValidate: { time: 40, ratio: 3 },
} as const;

/** A function that a benchmark times, with its name. */
export interface Timed {
  readonly name: string;
  readonly fn: () => unknown;
}

/** The most that the fastest sample of a benchmark with no reference may take, in milliseconds, set as the times of {@link BUDGETS} are. */
export const TIMES = {
  /** `prepareLaunch` over stores in memory and the LRS in the same process. */
  prepareLaunch: 9,
} as const;

/**
 * Times a function and its reference in turns (`alternate` of `scripts/bench-rounds.ts`), reports both, and fails the test when
 * the fastest sample of the function is above its time or above its ratio to the fastest sample of the reference.
 */
export async function expectRatioInTurns(
  context: Pick<TestContext, "annotate" | "bench">,
  name: keyof typeof BUDGETS,
  reference: Timed,
  measured: Timed,
  options: BenchOptions = BENCH_OPTIONS,
): Promise<void> {
  const sides = await alternate(
    context.bench,
    measured.name,
    measured.fn,
    { name: reference.name, run: reference.fn },
    options,
  );
  const { time, ratio: limit } = BUDGETS[name];
  const ratio = await reportRatio(context.annotate, name, reference.name, sides, limit);
  await context.annotate(`${name}: time budget ${time} ms`);
  expect(sides.ours.min, `The fastest sample of ${name} in milliseconds`).toBeLessThan(time);
  expect(ratio, `The fastest sample of ${name} as a multiple of the fastest sample of ${reference.name}`).toBeLessThan(
    limit,
  );
}

/** Reports the fastest and the median sample of a benchmark with no reference, and fails the test when the fastest is above its time. */
export async function expectWithin(
  annotate: TestContext["annotate"],
  name: keyof typeof TIMES,
  result: { readonly latency: { readonly min: number; readonly p50: number } },
): Promise<void> {
  const { min, p50 } = result.latency;
  await annotate(`${name}: fastest ${min.toFixed(3)} ms, median ${p50.toFixed(3)} ms, budget ${TIMES[name]} ms`);
  expect(min, `The fastest sample of ${name} in milliseconds`).toBeLessThan(TIMES[name]);
}
