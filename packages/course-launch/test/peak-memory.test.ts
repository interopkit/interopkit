import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Bundle, bundleReadings, readInProcess, removeBundle, risen } from "../../../scripts/peak-memory.js";
import type { READINGS } from "./peak-memory-readings.js";

/**
 * Each reader of untrusted input on its worst input within its limits, in a process whose heap holds at most the heap given:
 * twice the least heap in which it ended on Node.js 22 and 24, rounded up to 16 MiB (`node scripts/peak-memory.ts course-launch`). A
 * reading without its limit keeps far more alive, and fails.
 */
const CASES: readonly {
  readonly title: string;
  readonly name: keyof typeof READINGS;
  readonly heapMiB: number;
  readonly outcome: string;
}[] = [
  {
    title: "reads a structure of almost a million texts, at the limit of elements",
    name: "structureTexts",
    heapMiB: 160,
    outcome: "999901 texts",
  },
  {
    title: "refuses 16 MiB of empty elements at the limit of elements, before the model holds them",
    name: "structureElements",
    heapMiB: 160,
    outcome:
      "LimitError: The course structure has more than 1000000 elements and attributes, the limit of the option maxElements.",
  },
  {
    title: "refuses 16 MiB of nested blocks at the limit of depth, before it keeps a frame for each",
    name: "structureDepth",
    heapMiB: 64,
    outcome: "LimitError: The course structure nests more than 64 elements, the limit of the option maxDepth.",
  },
  {
    title: "reads one langstring of almost 16 MiB",
    name: "structureText",
    heapMiB: 128,
    outcome: "a text of 16775215 characters",
  },
  {
    title: "judges a million wrong values, and keeps the findings of the limit and one that says it stopped",
    name: "structureFindings",
    heapMiB: 48,
    outcome: "1001 findings, the last findings-stopped",
  },
  {
    title: "reads a package of 100,000 entries, the limit",
    name: "packageEntries",
    heapMiB: 64,
    outcome: "100000 files",
  },
  {
    title: "reads a package whose central directory is almost its limit of 16 MiB",
    name: "packageDirectory",
    heapMiB: 32,
    outcome: "255 files",
  },
  {
    title: "refuses a package whose cmi5.xml inflates to 64 MiB and says it has 64 bytes, without inflating it",
    name: "packageInflate",
    heapMiB: 32,
    outcome: "DataError: The ZIP package is not a valid ZIP archive: Invalid uncompressed size.",
  },
  {
    title: "refuses a launch URL at its limit whose actor has the most tokens it holds, before it parses the actor",
    name: "launchUrl",
    heapMiB: 32,
    outcome: "LimitError: The actor of the launch URL has more than 1000 tokens of JSON, more than an Agent needs.",
  },
  {
    title: "judges and takes a batch of 1,000 statements of a unit near the 10 MiB of a request",
    name: "lmsBatch",
    heapMiB: 80,
    outcome: "status 200",
  },
  {
    title: "refuses a preferences document of 10 MiB that a unit writes, after its limit of 4,096 bytes",
    name: "lmsPreferences",
    heapMiB: 32,
    outcome: "status 403",
  },
  {
    title: "refuses an answer of the fetch URL at its limit with the most tokens it holds, before it parses it",
    name: "unitFetch",
    heapMiB: 32,
    outcome: "ServiceError: The fetch URL answered with neither an auth-token nor an error code of cmi5.",
  },
  {
    title: "refuses launch data at their limit with the most values they hold",
    name: "unitLaunchData",
    heapMiB: 48,
    outcome: 'DataError: The launch data is invalid: missing the property "launchMode".',
  },
  {
    title: "refuses a preferences document of 1 MiB, over its limit of 4,096 bytes, without parsing it",
    name: "unitPreferences",
    heapMiB: 32,
    outcome: "ServiceError: The preferences of the learner has more than 4096 bytes.",
  },
  {
    title: "refuses an answer of more than 1 MiB to the query of what the registration held",
    name: "unitPrior",
    heapMiB: 32,
    outcome: "the limit of the option maxBytes",
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
