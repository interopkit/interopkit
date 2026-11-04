import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Bundle, bundleReadings, readInProcess, removeBundle, risen } from "../../../scripts/peak-memory.js";
import type { READINGS } from "./peak-memory-readings.js";

/**
 * Each reader of untrusted input on its worst input within its limits, in a process whose heap holds at most the heap given:
 * twice the least heap in which it ended on Node.js 22 and 24, rounded up to 16 MiB (`node scripts/peak-memory.ts tool-integration`). A
 * reading without its limit keeps far more alive, and fails.
 */
const CASES: readonly {
  readonly title: string;
  readonly name: keyof typeof READINGS;
  readonly heapMiB: number;
  readonly outcome: string;
}[] = [
  {
    title:
      "refuses the claims of a token of 1.2 million empty objects by the number of tokens, before the signature is verified",
    name: "claims",
    heapMiB: 32,
    outcome: "LtiError token-malformed",
  },
  {
    title:
      "refuses a launch whose form is at the limit with one array of small objects as its token, and one whose form is far above the limit",
    name: "launch",
    heapMiB: 16,
    outcome: "LtiError token-malformed; LimitError maxFormBytes",
  },
  {
    title:
      "refuses the authentication and token requests whose forms are at the limit of repeated or of distinct parameters, or far above it",
    name: "platformForms",
    heapMiB: 16,
    outcome: "6 requests, each refused with 400, 405 or 413",
  },
  {
    title: "refuses control requests of 64 KiB of nesting and of arrays",
    name: "platformControl",
    heapMiB: 32,
    outcome: "statuses 413, 400",
  },
  {
    title: "refuses line items and scores of 64 KiB of nesting and of arrays",
    name: "platformGrades",
    heapMiB: 32,
    outcome: "statuses 413, 400, 413, 400",
  },
  {
    title: "refuses registrations of 64 KiB of nesting and of arrays",
    name: "platformRegistration",
    heapMiB: 16,
    outcome: "statuses 413, 400",
  },
  {
    title: "refuses a Deep Linking response of under 1 MiB that lists 10,000 items, by their number",
    name: "deepLinking",
    heapMiB: 32,
    outcome: "a form of more than half a MiB: LimitError maxContentItems",
  },
  {
    title: "reads a Start Assessment message whose form is at the limit with one array of small objects as its token",
    name: "startAssessment",
    heapMiB: 32,
    outcome: "a form of almost the limit, attempt 1",
  },
  {
    title: "reads a control status just under the limits of bytes and tokens, and refuses an answer far above them",
    name: "toolControl",
    heapMiB: 64,
    outcome: "running; refused by maxBytes",
  },
  {
    title: "refuses login initiations at the limit of repeated and of distinct parameters, and a form far above it",
    name: "toolLogin",
    heapMiB: 16,
    outcome: "DataError; DataError; LimitError maxBytes; DataError; DataError",
  },
  {
    title: "reads a preferences record just under the limits of bytes and tokens, and refuses an answer far above them",
    name: "toolPreferences",
    heapMiB: 96,
    outcome: "330000 objects; refused by maxBytes",
  },
  {
    title: "registers a tool from an answer just under the limit of bytes, and refuses one of 1 MiB",
    name: "toolRegister",
    heapMiB: 32,
    outcome: "under the limit, client tool-2; refused by maxBytes",
  },
  {
    title: "discovers a platform from a configuration just under the limit of bytes, and refuses one of 1 MiB",
    name: "toolRegistration",
    heapMiB: 32,
    outcome: "issuer https://lms.example.edu; refused by maxBytes",
  },
  {
    title: "reads a page of members just under the limit of tokens, and refuses 1 MiB of empty members at it",
    name: "toolRoster",
    heapMiB: 64,
    outcome: "1 member; refused by the limit of the option maxTokens",
  },
  {
    title: "reads a page of line items just under the limit of tokens, and refuses 1 MiB of empty objects at it",
    name: "toolServices",
    heapMiB: 96,
    outcome: "1 line item; refused by the limit of the option maxTokens",
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
