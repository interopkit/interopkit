// The comparison of a function with its reference in a benchmark, timed in turns, which the `budgets.ts` of each package reads.

import type { TestContext } from "vitest";

/**
 * The rounds of a comparison. Each round times the reference and the function in turns, the reference first in one round and
 * second in the next, so that a change in the load of a shared machine falls on both sides alike.
 */
const ROUNDS = 3;

/** The run options of a round: the time and the number of samples of tinybench, and its warm-up. */
export interface RoundOptions {
  readonly time: number;
  readonly iterations: number;
  readonly warmupTime: number;
  readonly warmupIterations: number;
}

/** The fastest and the median sample of a function, in milliseconds. */
interface Timing {
  /** The fastest sample over the rounds: the one least affected by the other work of a shared machine. */
  readonly min: number;
  /** The median of the medians of the rounds. */
  readonly p50: number;
}

/** A function and its reference, timed in turns. */
export interface Sides {
  readonly ours: Timing;
  readonly theirs: Timing;
}

/** What `bench(...).run` resolves to that a timing reads. */
interface RoundResult {
  readonly latency: { readonly min: number; readonly p50: number };
}

/** The fastest of the fastest samples of the rounds, and the median of their medians. */
function timingOf(results: readonly RoundResult[]): Timing {
  const medians = results.map(({ latency }) => latency.p50).toSorted((first, second) => first - second);
  return {
    min: Math.min(...results.map(({ latency }) => latency.min)),
    p50: medians[Math.floor(medians.length / 2)] ?? Number.NaN,
  };
}

/**
 * Times a function and its reference in `ROUNDS` rounds, alternating which runs first, and returns the fastest sample and the
 * median of the medians of each.
 *
 * @param bench - The `bench` of the test.
 * @param name - The name of the function in the report.
 * @param ours - The function.
 * @param reference - The name of the reference in the report, and the reference.
 * @param options - The run options of each round.
 */
export async function alternate(
  bench: TestContext["bench"],
  name: string,
  ours: () => unknown,
  reference: { readonly name: string; readonly run: () => unknown },
  options: RoundOptions,
): Promise<Sides> {
  const mine: RoundResult[] = [];
  const theirs: RoundResult[] = [];
  for (let round = 1; round <= ROUNDS; round += 1) {
    const runOurs = async () => mine.push(await bench(`${name}, round ${round}`, ours).run(options));
    const runTheirs = async () =>
      theirs.push(await bench(`${reference.name}, round ${round}`, reference.run).run(options));
    if (round % 2 === 1) {
      await runTheirs();
      await runOurs();
    } else {
      await runOurs();
      await runTheirs();
    }
  }
  return { ours: timingOf(mine), theirs: timingOf(theirs) };
}

/**
 * Reports the fastest and the median sample of a function and of its reference with their ratio, and returns the ratio of the
 * fastest samples, which a budget bounds.
 */
export async function reportRatio(
  annotate: TestContext["annotate"],
  name: string,
  reference: string,
  { ours, theirs }: Sides,
  budget: number,
): Promise<number> {
  const ratio = ours.min / theirs.min;
  await annotate(
    `${name}: fastest ${ours.min.toFixed(3)} ms, median ${ours.p50.toFixed(3)} ms; ${reference}: fastest ${theirs.min.toFixed(3)} ms, median ${theirs.p50.toFixed(3)} ms; ratio ${ratio.toFixed(3)}, budget ${budget}`,
  );
  return ratio;
}
