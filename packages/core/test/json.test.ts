import { describe, expect, it } from "vitest";
import { copyJson, MAX_JSON_DEPTH } from "../src/checks.js";

/** An object that nests the given number of levels, the outermost included. */
function nest(levels: number): Record<string, unknown> {
  let value: Record<string, unknown> = {};
  for (let level = 1; level < levels; level += 1) value = { n: value };
  return value;
}

describe("copyJson", () => {
  it("copies every kind of JSON value into new objects and arrays", () => {
    const input = { a: [1, 2.5, null, true, "text", { b: [] }], c: { d: "e" } };
    const result = copyJson(input, "value");
    expect(result).toStrictEqual({ value: input });
    if (!("value" in result)) throw new Error("The value is JSON.");
    expect(result.value).not.toBe(input);
    expect(result.value.a).not.toBe(input.a);
    expect(result.value.c).not.toBe(input.c);
    expect((result.value.a as unknown[])[5]).not.toBe(input.a[5]);
  });

  it("copies a value that is not an object, and a list of lists", () => {
    expect(copyJson("text", "the text")).toStrictEqual({ value: "text" });
    expect(copyJson([[1], [2]], "lists")).toStrictEqual({ value: [[1], [2]] });
  });

  it("keeps a member named __proto__ as a member and never as the prototype", () => {
    const input: Record<string, unknown> = JSON.parse('{"__proto__": {"polluted": true}, "plain": 1}');
    const result = copyJson(input, "value");
    if (!("value" in result)) throw new Error("The value is JSON.");
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.keys(result.value).sort()).toStrictEqual(["__proto__", "plain"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("reads an object without a prototype", () => {
    const bare = Object.create(null);
    bare.a = { b: [1, "two"] };
    expect(copyJson(bare, "value")).toStrictEqual({ value: { a: { b: [1, "two"] } } });
  });

  it.each([
    ["a function", () => 1, "a function, which JSON cannot hold"],
    ["undefined", undefined, "undefined, which JSON cannot hold"],
    ["a symbol", Symbol("s"), "a symbol, which JSON cannot hold"],
    ["a bigint", 1n, "a bigint, which JSON cannot hold"],
    ["NaN", Number.NaN, "the number NaN, which JSON cannot write"],
    ["infinity", Number.POSITIVE_INFINITY, "the number Infinity, which JSON cannot write"],
    ["a date", new Date(0), "an object that is not plain, which JSON cannot hold"],
    ["a map", new Map(), "an object that is not plain, which JSON cannot hold"],
  ])("refuses %s and says where it is", (_name, member, what) => {
    expect(copyJson({ list: [{ member }] }, "extensions")).toStrictEqual({
      problem: `extensions.list[0].member is ${what}`,
    });
  });

  it("names the value as a whole when it has no path, and a member from the start", () => {
    expect(copyJson(new Date(0), "")).toStrictEqual({
      problem: "the value is an object that is not plain, which JSON cannot hold",
    });
    expect(copyJson({ member: () => 1 }, "")).toStrictEqual({
      problem: "member is a function, which JSON cannot hold",
    });
  });

  it("holds at most as many levels as the limit, in objects and in lists", () => {
    expect(copyJson(nest(MAX_JSON_DEPTH), "value")).toHaveProperty("value");
    expect(copyJson(nest(MAX_JSON_DEPTH + 1), "value")).toHaveProperty("problem");
    let list: unknown[] = [];
    for (let level = 1; level < MAX_JSON_DEPTH; level += 1) list = [list];
    expect(copyJson({ list }, "value")).toHaveProperty("problem");
  });

  it("stops a hostile depth at the limit, whatever it is", () => {
    let value: Record<string, unknown> = {};
    for (let level = 0; level < 200_000; level += 1) value = { n: value };
    expect(copyJson(value, "value")).toStrictEqual({
      problem: `value${".n".repeat(MAX_JSON_DEPTH)} nests more than ${MAX_JSON_DEPTH} levels, the most that a JSON value may here`,
    });
  });
});
