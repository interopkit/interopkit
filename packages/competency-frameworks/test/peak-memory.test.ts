import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Bundle, bundleReadings, readInProcess, removeBundle, risen } from "../../../scripts/peak-memory.js";
import type { READINGS } from "./peak-memory-readings.js";

/**
 * Each reader of untrusted input on its worst input within its limits, in a process whose heap holds at most the heap given:
 * twice the least heap in which it ended on Node.js 22 and 24, rounded up to 16 MiB (`node scripts/peak-memory.ts competency-frameworks`). A
 * reading without its limit keeps far more alive, and fails.
 */
const CASES: readonly {
  readonly title: string;
  readonly name: keyof typeof READINGS;
  readonly heapMiB: number;
  readonly outcome: string;
}[] = [
  {
    title: "refuses a request with a fields list of 10 MiB before it splits the list",
    name: "providerFields",
    heapMiB: 64,
    outcome: "status 400",
  },
  {
    title: "refuses the associations of an item that are a million wrong ones, and counts the errors of the limit",
    name: "readEntity",
    heapMiB: 32,
    outcome: "DataError: The CFAssociationSet is invalid at CFAssociations[0]",
  },
  {
    title: "refuses a package with a million wrong items, and counts the errors of the limit",
    name: "readPackage",
    heapMiB: 32,
    outcome: "DataError: The package is invalid at CFItems[0]",
  },
  {
    title:
      "judges a package with a million wrong items, and lists the findings of the limit and one that says it stopped",
    name: "validatePackage",
    heapMiB: 32,
    outcome: "1001 findings, the last findings-stopped",
  },
  {
    title: "reads the largest package that the limits of a client take, to the last item",
    name: "clientPackage",
    heapMiB: 128,
    outcome: "every one of 15000 items",
  },
  {
    title: "reads extensions of as many distinct keys as the limits of a client take, every key",
    name: "clientKeys",
    heapMiB: 288,
    outcome: "499000 keys",
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
