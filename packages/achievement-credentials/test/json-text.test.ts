import { describe, expect, it } from "vitest";
import { textWithinLimits } from "../src/json-text.js";

const LIMITS = { maxCharacters: 100, maxDepth: 4, maxTokens: 30 };

describe("the text of a value", () => {
  it("is the JSON of the value when it is within the limits", () => {
    expect(textWithinLimits({ a: [1, 2] }, LIMITS, "The value")).toStrictEqual({ text: '{"a":[1,2]}' });
  });

  it.each([
    [
      "holds itself",
      (() => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      })(),
      "is not JSON",
    ],
    ["holds a BigInt", { a: 1n }, "is not JSON"],
    ["is undefined", undefined, "is not JSON"],
    ["is over the characters", { a: "x".repeat(100) }, "characters"],
    ["is over the tokens", { a: Array.from({ length: 20 }, () => 1) }, "tokens"],
    ["is over the levels", { a: { b: { c: { d: { e: 1 } } } } }, "levels"],
  ])("is refused when the value %s", (_name, value, said) => {
    const result = textWithinLimits(value, LIMITS, "The value");
    expect(result).toHaveProperty("reason");
    expect(JSON.stringify(result)).toContain(said);
  });

  it("is checked for its size before its tokens and its tokens before its levels", () => {
    const wide = { a: "x".repeat(200), b: { c: { d: { e: { f: 1 } } } } };
    expect(JSON.stringify(textWithinLimits(wide, LIMITS, "The value"))).toContain("characters");
    const tokens = { a: [[[[[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]]]]] };
    expect(JSON.stringify(textWithinLimits(tokens, LIMITS, "The value"))).toContain("tokens");
  });
});
