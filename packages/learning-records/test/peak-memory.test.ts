import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Bundle, bundleReadings, readInProcess, removeBundle, risen } from "../../../scripts/peak-memory.js";
import type { READINGS } from "./peak-memory-readings.js";

/**
 * Each reader of untrusted input on its worst input within its limits, in a process whose heap holds at most the heap given:
 * twice the least heap in which it ended on Node.js 22 and 24, rounded up to 16 MiB (`node scripts/peak-memory.ts learning-records`). A
 * reading without its limit keeps far more alive, and fails.
 */
const CASES: readonly {
  readonly title: string;
  readonly name: keyof typeof READINGS;
  readonly heapMiB: number;
  readonly outcome: string;
}[] = [
  {
    title: "reads a Basic header of 10 MiB that holds no colon, and finds no credentials",
    name: "basicHeader",
    heapMiB: 32,
    outcome: "no credentials",
  },
  {
    title: "reads a million tokens of distinct names, the most that the search for a repeat keeps",
    name: "statementJson",
    heapMiB: 80,
    outcome: "249999 names",
  },
  {
    title:
      "judges a batch whose Statement has a million wrong Activities, and lists the findings of the limit and one that says it stopped",
    name: "validateStatements",
    heapMiB: 32,
    outcome: "1001 findings, the last findings-stopped",
  },
  {
    title: "reads the payload of a signature of the most tokens that the reader takes, which no key verifies",
    name: "signature",
    heapMiB: 176,
    outcome: "invalid, no-key",
  },
  {
    title: "reads a message of the most parts and bytes that the limits take",
    name: "multipart",
    heapMiB: 16,
    outcome: "99 parts",
  },
  {
    title: "stores the largest batch of Statements that the limits of a request take",
    name: "storeBatch",
    heapMiB: 48,
    outcome: "status 200, 1000 Statements stored",
  },
  {
    title:
      "refuses a form of the alternate request syntax of a million and a half distinct names by their number, without reading it",
    name: "alternateNames",
    heapMiB: 16,
    outcome: "status 400",
  },
  {
    title:
      "reads a form of the alternate request syntax of 10 MiB written as plus signs, before the request is authenticated",
    name: "alternateSpaces",
    heapMiB: 64,
    outcome: "status 400",
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
