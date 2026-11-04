import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Bundle, bundleReadings, readInProcess, removeBundle, risen } from "../../../scripts/peak-memory.js";
import type { READINGS } from "./peak-memory-readings.js";

/**
 * Each reader of untrusted input on its worst input within its limits, in a process whose heap holds at most the heap given:
 * twice the least heap in which it ended on Node.js 22 and 24, rounded up to 16 MiB (`node scripts/peak-memory.ts core`). A
 * reading without its limit keeps far more alive, and fails.
 */
const CASES: readonly {
  readonly title: string;
  readonly name: keyof typeof READINGS;
  readonly heapMiB: number;
  readonly outcome: string;
}[] = [
  {
    title: "reads an answer without end only to the limit of 1 MiB and cancels the rest",
    name: "serviceEndless",
    heapMiB: 16,
    outcome: "ServiceError, read to the limit, cancelled",
  },
  {
    title: "reads a form of 10 MiB of plus signs",
    name: "formPluses",
    heapMiB: 16,
    outcome: "a value of 10485758 characters",
  },
  {
    title: "reads a body at the size limit that holds the most objects that the tokens allow",
    name: "jsonObjects",
    heapMiB: 64,
    outcome: "a list of 333332 objects",
  },
  {
    title: "refuses the key sets at the limits of bytes and keys, one nested too deep to copy, and one far above",
    name: "keySets",
    heapMiB: 32,
    outcome: "DataError above the limit of 100 keys; JWKSNoMatchingKey; DataError; ServiceError",
  },
];

let bundle: Bundle;
beforeAll(async () => {
  bundle = await bundleReadings(`${import.meta.dirname}/peak-memory-readings.ts`);
});
afterAll(() => removeBundle(bundle));

describe("the peak memory of each reader of untrusted input, on its worst input", () => {
  for (const { title, name, heapMiB, outcome } of CASES) {
    it(`${title}, within a heap of ${heapMiB} MiB`, async ({ annotate }) => {
      const result = await readInProcess(bundle, name, heapMiB);
      await annotate(risen(result.rise));
      expect(result.outcome).toContain(outcome);
    });
  }
});
