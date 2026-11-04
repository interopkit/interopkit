import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Bundle, bundleReadings, readInProcess, removeBundle, risen } from "../../../scripts/peak-memory.js";
import type { READINGS } from "./peak-memory-readings.js";

/**
 * Each reader of untrusted input on its worst input within its limits, in a process whose heap holds at most the heap given:
 * twice the least heap in which it ended on Node.js 22 and 24, rounded up to 16 MiB (`node scripts/peak-memory.ts learning-analytics`). A
 * reading without its limit keeps far more alive, and fails.
 */
const CASES: readonly {
  readonly title: string;
  readonly name: keyof typeof READINGS;
  readonly heapMiB: number;
  readonly outcome: string;
}[] = [
  {
    title: "refuses an event whose object holds a list of a million wrong values, at the first",
    name: "readEvent",
    heapMiB: 64,
    outcome: "DataError: The event is invalid at object.items[0]",
  },
  {
    title: "refuses an entity whose members are a list of a million wrong values, at the first",
    name: "readEntity",
    heapMiB: 64,
    outcome: "DataError: The entity is invalid at members[0]",
  },
  {
    title:
      "judges an event whose object holds a list of a million wrong values, and keeps the findings of the limit and one that says it stopped",
    name: "validateEvent",
    heapMiB: 64,
    outcome: "1001 findings, the last findings-stopped",
  },
  {
    title:
      "judges an event of Caliper 1.1 with a list of a million wrong values, and keeps the findings of the limit and one that says it stopped",
    name: "validateEvent1p1",
    heapMiB: 64,
    outcome: "1001 findings, the last findings-stopped",
  },
  {
    title:
      "reads an envelope with a million wrong values, and lists the findings of the limit and one that says it stopped",
    name: "readEnvelope",
    heapMiB: 64,
    outcome: "0 events, 1001 findings, the last findings-stopped",
  },
  {
    title: "receives an envelope of 1 MiB of events and hands every event to accept",
    name: "endpointEnvelope",
    heapMiB: 32,
    outcome: "status 200, 1612 events, 0 findings",
  },
  {
    title: "receives an envelope of Caliper 1.1 with 1 MiB of events and hands every event to accept",
    name: "endpointEnvelope1p1",
    heapMiB: 32,
    outcome: "status 200, 1.1, 1738 events, 0 findings",
  },
  {
    title: "receives an event whose extensions have as many distinct keys as 1 MiB holds and hands it to accept",
    name: "endpointKeys",
    heapMiB: 48,
    outcome: "status 200, 1 event",
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
