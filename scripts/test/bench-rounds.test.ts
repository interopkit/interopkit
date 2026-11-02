import type { TestContext } from "vitest";
import { describe, expect, it } from "vitest";
import { alternate } from "../bench-rounds.ts";

const OPTIONS = { time: 0, iterations: 1, warmupTime: 0, warmupIterations: 0 };

/** A `bench` that records the order of the runs and answers each with the samples that the test gives for its name. */
function recordingBench(samples: Readonly<Record<string, readonly [number, number]>>) {
  const order: string[] = [];
  const bench = ((name: string) => ({
    run: async () => {
      order.push(name);
      const [min, p50] = samples[name] ?? [Number.NaN, Number.NaN];
      return { latency: { min, p50 } };
    },
  })) as unknown as TestContext["bench"];
  return { bench, order };
}

describe("the comparison of a function with its reference in turns", () => {
  it("runs three rounds, the reference first in the first and the last, the function first in the second", async () => {
    const { bench, order } = recordingBench({});
    await alternate(bench, "ours", () => undefined, { name: "theirs", run: () => undefined }, OPTIONS);
    expect(order).toStrictEqual([
      "theirs, round 1",
      "ours, round 1",
      "ours, round 2",
      "theirs, round 2",
      "theirs, round 3",
      "ours, round 3",
    ]);
  });

  it("keeps the fastest sample of each side over the rounds and the median of their medians", async () => {
    const { bench } = recordingBench({
      "ours, round 1": [2, 9],
      "ours, round 2": [1, 3],
      "ours, round 3": [4, 5],
      "theirs, round 1": [8, 10],
      "theirs, round 2": [6, 30],
      "theirs, round 3": [7, 20],
    });
    const sides = await alternate(bench, "ours", () => undefined, { name: "theirs", run: () => undefined }, OPTIONS);
    expect(sides).toStrictEqual({ ours: { min: 1, p50: 5 }, theirs: { min: 6, p50: 20 } });
  });
});
