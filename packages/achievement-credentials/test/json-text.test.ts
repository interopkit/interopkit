import { DataError, LimitError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { textWithinLimits } from "../src/json-text.js";

const LIMITS = { maxInputBytes: 100, maxDepth: 4, maxTokens: 30 };

describe("the text of a value", () => {
  it("is the JSON of the value when it is within the limits", () => {
    expect(textWithinLimits({ a: [1, 2] }, LIMITS, "The value")).toBe('{"a":[1,2]}');
  });

  it.each([
    [
      "holds itself",
      (() => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      })(),
    ],
    ["holds a BigInt", { a: 1n }],
    ["is undefined", undefined],
  ])("is refused as no JSON when the value %s", (_name, value) => {
    expect(() => textWithinLimits(value, LIMITS, "The value")).toThrow(new DataError("The value is not JSON."));
  });

  it.each([
    ["characters", { a: "x".repeat(100) }, "maxInputBytes", 100],
    ["tokens", { a: Array.from({ length: 20 }, () => 1) }, "maxTokens", 30],
    ["levels", { a: { b: { c: { d: { e: 1 } } } } }, "maxDepth", 4],
  ])("is refused over its %s with a LimitError that names the limit", (_name, value, limit, maximum) => {
    expect(() => textWithinLimits(value, LIMITS, "The value")).toThrow(
      expect.objectContaining({ name: "LimitError", limit, maximum }),
    );
  });

  it("is checked for its size before its levels, and for its levels before its tokens", () => {
    const wide = { a: "x".repeat(200), b: { c: { d: { e: { f: 1 } } } } };
    expect(() => textWithinLimits(wide, LIMITS, "The value")).toThrow(
      expect.objectContaining({ limit: "maxInputBytes" }),
    );
    // The numbers pass the tokens before the brackets pass the levels.
    const both = { a: Array.from({ length: 40 }, () => 1), b: [[[[[1]]]]] };
    expect(() => textWithinLimits(both, { maxDepth: 4, maxTokens: 30 }, "The value")).toThrow(
      new LimitError("The value nests more than 4 levels.", "maxDepth", 4),
    );
  });

  it("names the option that sets the tokens, and nests within 64 levels unless told otherwise", () => {
    const limits = { maxTokens: 3, tokensOption: "maxJsonLdTokens" };
    expect(() => textWithinLimits({ a: [1, 2] }, limits, "The credential")).toThrow(
      new LimitError(
        "The credential has more than the 3 tokens of JSON that the option maxJsonLdTokens allows.",
        "maxJsonLdTokens",
        3,
      ),
    );
    const nest = (levels: number) => JSON.parse(`${"[".repeat(levels)}${"]".repeat(levels)}`);
    expect(textWithinLimits(nest(64), { maxTokens: 1000 }, "The credential")).toHaveLength(128);
    expect(() => textWithinLimits(nest(65), { maxTokens: 1000 }, "The credential")).toThrow(
      expect.objectContaining({ limit: "maxDepth", maximum: 64 }),
    );
  });
});
