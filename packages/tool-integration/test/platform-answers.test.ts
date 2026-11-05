import { DataError, LimitError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { refusedBy } from "../src/platform/internal.js";

describe("refusedBy", () => {
  it("gives the DataError that a reader of a request threw, and the LimitError that is one, for the answer to say what is wrong", () => {
    const wrong = new DataError("The parameter state occurs more than once.");
    const large = new LimitError("The body is too large.", "maxBytes", 10);
    expect(refusedBy(wrong)).toBe(wrong);
    expect(refusedBy(large)).toBe(large);
  });

  it("passes a failure that is no DataError, so that a refusal never hides a bug of the code or a failure of the host", () => {
    for (const failure of [
      new TypeError("Cannot read properties of undefined"),
      new Error("The disk is full."),
      "text",
    ]) {
      expect(() => refusedBy(failure)).toThrow(failure as never);
    }
  });
});
