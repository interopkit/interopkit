import { expect, type TestContext } from "vitest";
import { alternate, reportRatio } from "../../../scripts/bench-rounds.js";

/** The run options of every benchmark: the time and the number of samples of tinybench, and its warm-up. */
const BENCH_OPTIONS = { time: 500, iterations: 10, warmupTime: 100, warmupIterations: 3 } as const;

/**
 * The most that the fastest sample of a function may take as a multiple of the fastest sample of a reference in the same run:
 * five times the largest ratio measured, rounded up to one significant digit, as docs/course-launch/evidence.md explains. Both
 * samples come from one run, so a ratio holds on any machine. The budgets in time are pending the first sample of the runners
 * of CI: `prepareLaunch` is reported and not judged.
 */
export const RATIOS = {
  /**
   * `readCourseStructure` of LMS suite 101 (1,001 units), as a multiple of libxml2 validating it. Measured up to 3.34: saxes, a
   * parser in JavaScript, takes 2.0 times libxml2 in WebAssembly to parse the text alone, and the reader builds the model and
   * checks the rules of cmi5 that the schema leaves out.
   */
  structureAgainstLibxml2: 20,
  /** The same, as a multiple of saxes parsing it alone: the work of the reader beyond the parser. Measured up to 1.88. */
  structureAgainstSaxes: 10,
  /** `readCoursePackage` of a ZIP64 archive of 66,001 entries, as a multiple of zip.js listing its entries. Measured up to 0.77. */
  packageAgainstEntries: 4,
  /** The LRS of cmi5 judging the seven statements of a session, as a multiple of `validateStatements` of them. Measured up to 0.81. */
  sessionAgainstValidate: 5,
  /** The LRS of cmi5 judging 1,000 allowed statements of one request, as a multiple of `validateStatements` of them. Measured up to 0.31. */
  batchAgainstValidate: 2,
} as const;

/** A function that a benchmark times, with its name. */
export interface Timed {
  readonly name: string;
  readonly fn: () => unknown;
}

/**
 * Times a function and its reference in turns (`alternate` of `scripts/bench-rounds.ts`), reports both, and fails the test when
 * the fastest sample of the function is above its ratio to the fastest sample of the reference.
 */
export async function expectRatioInTurns(
  context: Pick<TestContext, "annotate" | "bench">,
  name: keyof typeof RATIOS,
  reference: Timed,
  measured: Timed,
): Promise<void> {
  const sides = await alternate(
    context.bench,
    measured.name,
    measured.fn,
    { name: reference.name, run: reference.fn },
    BENCH_OPTIONS,
  );
  const ratio = await reportRatio(context.annotate, name, reference.name, sides, RATIOS[name]);
  expect(ratio, `The fastest sample of ${name} as a multiple of the fastest sample of ${reference.name}`).toBeLessThan(
    RATIOS[name],
  );
}
