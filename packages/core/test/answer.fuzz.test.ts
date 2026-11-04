import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readStatusInfo, ServiceError } from "../src/index.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_261_105, numRuns: 400 };

describe("readStatusInfo on any text", () => {
  it("reads the status of an error whose body and Retry-After are any text, and throws nothing", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (body, delay) => {
        const detail = readStatusInfo(new ServiceError("Busy.", 429, body, { headers: { "retry-after": delay } }));
        expect(detail.retryAfterSeconds === undefined || Number.isSafeInteger(detail.retryAfterSeconds)).toBe(true);
      }),
      RUNS,
    );
  });

  it("reads the status of an error whose body is any JSON value, and throws nothing", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const detail = readStatusInfo(new ServiceError("Busy.", 429, JSON.stringify(value)));
        expect(detail.info === undefined || typeof detail.info.imsx_codeMajor === "string").toBe(true);
      }),
      RUNS,
    );
  });
});
