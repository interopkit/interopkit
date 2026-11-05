import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  copyJson,
  endOfJsonString,
  findExceededJsonLimit,
  findPrototypeName,
  hasMoreTokensThan,
  isSameJson,
  MAX_JSON_DEPTH,
  parseJsonText,
} from "../src/checks.js";
import { DataError, LimitError } from "../src/index.js";

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

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses a member named %s at any depth, and says where",
    (name) => {
      const input: unknown = JSON.parse(`{"plain": 1, "list": [{"${name}": {"polluted": true}}]}`);
      expect(copyJson(input, "value")).toStrictEqual({
        problem: `value.list[0].${name} is refused, since __proto__, constructor and prototype are names of the prototype chain, which a reader would drop or misread`,
      });
      expect(copyJson(JSON.parse(`{"${name}": 1}`), "")).toStrictEqual({
        problem: `${name} is refused, since __proto__, constructor and prototype are names of the prototype chain, which a reader would drop or misread`,
      });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  it("keeps a member whose name only begins like one of the prototype chain", () => {
    expect(copyJson(JSON.parse('{"prototypes": 1, "constructors": 2}'), "")).toStrictEqual({
      value: { prototypes: 1, constructors: 2 },
    });
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

describe("findPrototypeName", () => {
  it.each(["__proto__", "constructor", "prototype"])("finds an own property named %s", (name) => {
    expect(findPrototypeName(JSON.parse(`{"a":1,${JSON.stringify(name)}:{}}`))).toBe(name);
    expect(findPrototypeName(Object.assign(Object.create(null), { [name]: 1 }))).toBe(name);
  });

  it("finds __proto__, then constructor, then prototype, whatever the order of the members", () => {
    expect(findPrototypeName(JSON.parse('{"prototype":1,"constructor":2,"__proto__":3}'))).toBe("__proto__");
    expect(findPrototypeName(JSON.parse('{"prototype":1,"constructor":2}'))).toBe("constructor");
  });

  it("finds nothing in an object that only inherits the names, in a nested member, or in a value that is not an object", () => {
    for (const value of [{}, [], JSON.parse('{"a":{"__proto__":1}}'), null, undefined, "constructor", 1, () => 1]) {
      expect(findPrototypeName(value)).toBeUndefined();
    }
  });
});

describe("isSameJson", () => {
  it("compares primitives by value, arrays in order and objects in any order", () => {
    expect(isSameJson(1, 1)).toBe(true);
    expect(isSameJson("a", "a")).toBe(true);
    expect(isSameJson(null, null)).toBe(true);
    expect(isSameJson(1, "1")).toBe(false);
    expect(isSameJson(null, {})).toBe(false);
    expect(isSameJson([1, 2], [1, 2])).toBe(true);
    expect(isSameJson([1, 2], [2, 1])).toBe(false);
    expect(isSameJson([1], [1, 1])).toBe(false);
    expect(isSameJson({ a: 1, b: [true] }, { b: [true], a: 1 })).toBe(true);
    expect(isSameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isSameJson({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
    expect(isSameJson({ 0: "x" }, ["x"])).toBe(false);
    expect(isSameJson([], {})).toBe(false);
  });

  it("compares values nested deeper than a stack holds", () => {
    const deep = (leaf: number) => {
      let value: unknown = leaf;
      for (let level = 0; level < 200_000; level += 1) value = [value];
      return value;
    };
    expect(isSameJson(deep(1), deep(1))).toBe(true);
    expect(isSameJson(deep(1), deep(2))).toBe(false);
  });

  it("finds any value the same as its copy, and as the copy with its members in another order", () => {
    const reversed = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reversed);
      if (typeof value !== "object" || value === null) return value;
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([name, member]) => [name, reversed(member)]),
      );
    };
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(isSameJson(value, structuredClone(value))).toBe(true);
        expect(isSameJson(value, reversed(value))).toBe(true);
      }),
      { seed: 20_261_104, numRuns: 300 },
    );
  });
});

describe("findExceededJsonLimit", () => {
  /** The limit that a text is refused for when only its depth is bounded. */
  const depthOf = (text: string, maxDepth: number) => findExceededJsonLimit(text, maxDepth, Number.POSITIVE_INFINITY);

  it("counts the levels of arrays and objects, and refuses one more than the limit", () => {
    expect(depthOf("[[[]]]", 3)).toBeUndefined();
    expect(depthOf("[[[[]]]]", 3)).toBe("depth");
    expect(depthOf('{"a":{"b":{"c":{}}}}', 3)).toBe("depth");
    expect(depthOf("1", 0)).toBeUndefined();
  });

  it("does not count brackets inside strings, whatever escapes come before them", () => {
    expect(depthOf('["[[[[", "\\\\"]', 1)).toBeUndefined();
    expect(depthOf('["\\\\"], [[[[', 2)).toBe("depth");
  });

  it("reads a text that is not JSON and stops at the first level above the limit", () => {
    expect(depthOf("[".repeat(100_000), 64)).toBe("depth");
    expect(depthOf('"unterminated [[[[', 1)).toBeUndefined();
  });

  it("refuses a text over both limits for its depth, whichever it passes first", () => {
    const tokensFirst = `[${"0,".repeat(10)}[[[[0]]]]]`;
    expect(findExceededJsonLimit(tokensFirst, 3, 5)).toBe("depth");
    expect(findExceededJsonLimit(tokensFirst, 5, 5)).toBe("tokens");
    expect(findExceededJsonLimit("[[[[0]]]]", 3, 5)).toBe("depth");
    expect(findExceededJsonLimit("[[[[0]]]]", 4, 100)).toBeUndefined();
  });
});

describe("hasMoreTokensThan", () => {
  /** The number of tokens of a value written as JSON, counted from the value and not from the text: the oracle. */
  function tokensOf(value: unknown): number {
    if (Array.isArray(value))
      return 2 + Math.max(0, value.length - 1) + value.reduce((sum, entry) => sum + tokensOf(entry), 0);
    if (typeof value === "object" && value !== null) {
      const entries = Object.values(value);
      return 2 + Math.max(0, entries.length - 1) + entries.reduce((sum, entry) => sum + 2 + tokensOf(entry), 0);
    }
    return 1;
  }

  it("agrees with the count of the value for any JSON value, written in any way", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.constantFrom(undefined, 1, "\t", "\n  "), (value, indent) => {
        const text = JSON.stringify(value, null, indent);
        const count = tokensOf(JSON.parse(text));
        expect(hasMoreTokensThan(text, count)).toBe(false);
        expect(hasMoreTokensThan(text, count - 1)).toBe(true);
      }),
      { seed: 20_261_102, numRuns: 300 },
    );
  });

  it("does not count what is inside a string, escaped quotes included", () => {
    const text = JSON.stringify(['[{"a":1,2}] "', 'a\\"', "\\", ",:"]);
    expect(hasMoreTokensThan(text, 9)).toBe(false);
    expect(hasMoreTokensThan(text, 8)).toBe(true);
  });

  it("counts a number or a literal as one token, whatever its length", () => {
    expect(hasMoreTokensThan("[-12345.678e+90,false]", 5)).toBe(false);
    expect(hasMoreTokensThan("[-12345.678e+90,false]", 4)).toBe(true);
  });

  it("stops at the first token above the limit, so that a text without end costs little", () => {
    expect(hasMoreTokensThan(`[${"0,".repeat(1_000_000)}`, 10)).toBe(true);
    expect(hasMoreTokensThan("", 0)).toBe(false);
    expect(hasMoreTokensThan("   \n\t ", 0)).toBe(false);
  });
});

describe("endOfJsonString", () => {
  it("finds the quote that ends the string", () => {
    expect(endOfJsonString('"abc"', 0)).toBe(4);
    expect(endOfJsonString('["abc", 1]', 1)).toBe(5);
  });

  it("skips a quote that a backslash escapes, and stops at one that an escaped backslash leaves", () => {
    expect(endOfJsonString(String.raw`["a\"b", 1]`, 1)).toBe(6);
    expect(endOfJsonString(String.raw`["a\\", 1]`, 1)).toBe(5);
    expect(endOfJsonString(String.raw`["a\\\"b", 1]`, 1)).toBe(8);
  });

  it("gives the length of the text for a string that does not end", () => {
    expect(endOfJsonString('["unterminated', 1)).toBe(14);
    expect(endOfJsonString(String.raw`"a\"`, 0)).toBe(4);
  });
});

describe("parseJsonText", () => {
  const refusals = {
    depth: "The text nests too deep.",
    tokens: "The text has too many tokens.",
    syntax: (cause: unknown) => `The text is not JSON: ${String(cause).slice(0, 11)}.`,
  };

  it("parses a text within the limits", () => {
    expect(parseJsonText('{"a":[1,{"b":null}]}', { maxDepth: 3, maxTokens: 13 }, refusals)).toStrictEqual({
      a: [1, { b: null }],
    });
  });

  it("keeps a property named __proto__ as an own property", () => {
    const value = parseJsonText('{"__proto__":{"x":1}}', { maxDepth: 3, maxTokens: 20 }, refusals) as object;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.keys(value)).toStrictEqual(["__proto__"]);
  });

  it("refuses the depth with the limit maxDepth, even when the text passes the tokens first", () => {
    for (const text of ["[[[[]]]]", `[${"0,".repeat(30)}[[[[0]]]]]`]) {
      const failure = (() => {
        try {
          parseJsonText(text, { maxDepth: 3, maxTokens: 10 }, refusals);
        } catch (error) {
          return error;
        }
      })();
      expect(failure, text).toBeInstanceOf(LimitError);
      expect(failure).toMatchObject({ message: refusals.depth, limit: "maxDepth", maximum: 3 });
    }
  });

  it("refuses the tokens with the limit maxTokens when the depth is within its limit", () => {
    expect(() => parseJsonText(`[${"0,".repeat(30)}0]`, { maxDepth: 3, maxTokens: 10 }, refusals)).toThrow(
      expect.objectContaining({ message: refusals.tokens, limit: "maxTokens", maximum: 10 }),
    );
  });

  it("refuses a text that is not JSON with the sentence of the caller and the error of JSON.parse as the cause", () => {
    const failure = (() => {
      try {
        parseJsonText("{", { maxDepth: 3, maxTokens: 10 }, refusals);
      } catch (error) {
        return error;
      }
    })();
    expect(failure).toBeInstanceOf(DataError);
    expect(failure).not.toBeInstanceOf(LimitError);
    expect((failure as DataError).cause).toBeInstanceOf(SyntaxError);
    expect((failure as DataError).message).toBe("The text is not JSON: SyntaxError.");
  });

  it("refuses a text of a million opening brackets without building anything", () => {
    expect(() => parseJsonText("[".repeat(1_000_000), { maxDepth: 64, maxTokens: 2_000_000 }, refusals)).toThrow(
      expect.objectContaining({ limit: "maxDepth" }),
    );
  });
});
