import { MAX_JSON_TOKENS } from "@interopkit/core/checks";
import { describe, expect, it } from "vitest";
import { handleLrsRequest } from "../src/store/index.js";
import { minimalStatement, uuid } from "./full-statement.js";
import { memory, optionsOf, requestOf } from "./memory-lrs.js";

const MIB = 1024 * 1024;
/**
 * The bytes that the request may raise the peak of the process by: the text, its parse, the Statements that the handler reads
 * and the batch that it stores. A parser that built a syntax tree took 250 MiB for the text alone.
 */
const BUDGET = 128 * MIB;

/** The Statements of the batch, the most that a request takes, and the numbers of the extension of each. */
const STATEMENTS = 1000;
const NUMBERS = 450;

/** The peak resident memory of the process so far, in bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** A batch of the most Statements, each with a list of numbers in an extension, near the most tokens that a request may have. */
function largestBatch(): string {
  const numbers = Array.from({ length: NUMBERS }, (_, index) => index);
  return JSON.stringify(
    Array.from({ length: STATEMENTS }, (_, index) => ({
      ...minimalStatement(),
      id: uuid(index + 1),
      result: { extensions: { "https://example.org/extensions/scores": numbers } },
    })),
  );
}

// Each test file runs in a process of its own, and the peak only grows, so this file measures one request.
describe("the peak memory of storing the largest batch that the limits take", () => {
  it("stays within the budget, and stores every Statement", async ({ annotate }) => {
    const text = largestBatch();
    const store = memory();
    const request = requestOf("POST", "/statements", { body: text, headers: { "content-type": "application/json" } });
    const before = peak();
    const response = await handleLrsRequest(request, optionsOf(store));
    const rise = peak() - before;
    expect(response.status).toBe(200);
    expect(store.held.size).toBe(STATEMENTS);
    await annotate(
      `The body has ${text.length} bytes, under ${MAX_JSON_TOKENS} tokens; the peak rose by ${(rise / MIB).toFixed(1)} MiB.`,
    );
    expect(rise).toBeLessThan(BUDGET);
  });
});
