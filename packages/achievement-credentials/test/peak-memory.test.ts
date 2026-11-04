import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Bundle, bundleReadings, readInProcess, removeBundle, risen } from "../../../scripts/peak-memory.js";
import type { READINGS } from "./peak-memory-readings.js";

/**
 * Each reader of untrusted input on its worst input within its limits, in a process whose heap holds at most the heap given:
 * twice the least heap in which it ended on Node.js 22 and 24, rounded up to 16 MiB (`node scripts/peak-memory.ts achievement-credentials`). A
 * reading without its limit keeps far more alive, and fails.
 */
const CASES: readonly {
  readonly title: string;
  readonly name: keyof typeof READINGS;
  readonly heapMiB: number;
  readonly outcome: string;
}[] = [
  {
    title: "reads a PNG whose credential holds the most objects of JSON that the limits leave",
    name: "bakingPng",
    heapMiB: 80,
    outcome: "a badge",
  },
  {
    title: "reads an SVG at the size limit whose credential is one long string",
    name: "bakingSvg",
    heapMiB: 112,
    outcome: "a badge whose credential is a string of 10484736 characters",
  },
  {
    title: "refuses a list of 5,000 alike items as a limit of canonicalization, at 1000 runs of the algorithm",
    name: "dataIntegrity",
    heapMiB: 128,
    outcome: "valid false, stopped at 1000 runs of the Hash N-Degree Quads algorithm",
  },
  {
    title: "verifies a JWS at its size limit whose payload holds the most numbers that the limit leaves room for",
    name: "jwtNumbers",
    heapMiB: 64,
    outcome: "verified true",
  },
  {
    title: "verifies a JWS at its size limit whose payload holds the most empty objects that the limit leaves room for",
    name: "jwtObjects",
    heapMiB: 144,
    outcome: "verified true",
  },
  {
    title: "refuses an upsert of a body at the size limit that holds the most objects of JSON",
    name: "provider",
    heapMiB: 112,
    outcome: "status 422",
  },
  {
    title: "refuses a status list within the fetch limit that inflates to 256 MiB, at the limit of what it inflates to",
    name: "status",
    heapMiB: 48,
    outcome: "failed: STATUS_VERIFICATION_ERROR: The encodedList inflates to more than",
  },
  {
    title:
      "judges an Open Badges 2.0 assertion with a list of a million wrong values, and stops the findings at the limit",
    name: "v2",
    heapMiB: 112,
    outcome: "1001 findings",
  },
  {
    title: "refuses the payload of a JWS of four million empty arrays by its tokens, without parsing it",
    name: "v2Payload",
    heapMiB: 80,
    outcome: "LimitError: The payload of the JWS has more than the 1000000 tokens of JSON",
  },
  {
    title: "verifies a CLR of 600 credentials whose refresh services each answer a credential of 600,000 characters",
    name: "verify",
    heapMiB: 64,
    outcome: "600 credentials of the CLR",
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
