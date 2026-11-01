import { tokenize } from "@humanwhocodes/momoa";
import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { readStatement, readStatementJson, validateStatements } from "../src/index.js";
import { fullStatement, minimalStatement } from "./full-statement.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_102, numRuns: 300 };

describe("readStatementJson", () => {
  it("returns the value that JSON.parse returns, for a Statement and for a batch", () => {
    for (const value of [fullStatement(), [minimalStatement(), fullStatement()]]) {
      const text = JSON.stringify(value);
      expect(readStatementJson(text)).toStrictEqual(JSON.parse(text));
    }
  });

  it("returns what JSON.parse returns, for any JSON value", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = JSON.stringify(value);
        expect(readStatementJson(text)).toStrictEqual(JSON.parse(text));
        expect(readStatementJson(JSON.stringify(value, null, "\t"))).toStrictEqual(JSON.parse(text));
      }),
      RUNS,
    );
  });

  it("reads the text of a Statement that an LRS then reads as a Statement", () => {
    const text = JSON.stringify(fullStatement());
    expect(readStatement(readStatementJson(text))).toStrictEqual(fullStatement());
    expect(validateStatements(readStatementJson(`[${text},${JSON.stringify(minimalStatement())}]`))).toStrictEqual([]);
  });

  describe("a property that occurs twice", () => {
    it.each([
      ['{"a":1,"a":2}', 'The text has the property "a" twice, at line 1 column 8.'],
      ['{"a":{"b":1,"b":2}}', 'The text has the property "b" twice in a, at line 1 column 13.'],
      ['[{"x":1},{"y":1,"y":1}]', 'The text has the property "y" twice in [1], at line 1 column 17.'],
      ['{"a":[{"b":{"c":1,"c":2}}]}', 'The text has the property "c" twice in a[0].b, at line 1 column 19.'],
      ['{\n  "actor": {},\n  "actor": {}\n}', 'The text has the property "actor" twice, at line 3 column 3.'],
      ['{"__proto__":1,"__proto__":2}', 'The text has the property "__proto__" twice, at line 1 column 16.'],
    ])("refuses %j, and says where", (text, sentence) => {
      expect(() => readStatementJson(text)).toThrow(DataError);
      expect(() => readStatementJson(text)).toThrow(sentence);
      expect(() => readStatementJson(text)).toThrow("An LRS rejects a property that occurs more than once.");
    });

    it("counts two names as one when the escapes in them write the same characters", () => {
      expect(() => readStatementJson('{"a":1,"\\u0061":2}')).toThrow('The text has the property "a" twice');
      expect(() => readStatementJson('{"\\/":1,"/":2}')).toThrow('The text has the property "/" twice');
    });

    it("reads the same name in objects that are not the same object", () => {
      const text = '{"a":{"id":1},"b":{"id":2},"c":[{"id":3},{"id":4}],"d":{"a":{"id":5}}}';
      expect(readStatementJson(text)).toStrictEqual(JSON.parse(text));
    });

    it("reads names that differ in case, and names that look alike", () => {
      const text = '{"id":1,"Id":2,"ID":3,"i d":4,"id ":5}';
      expect(readStatementJson(text)).toStrictEqual(JSON.parse(text));
    });

    it("refuses a repeat at any depth of a Statement", () => {
      const text = JSON.stringify(fullStatement()).replace(
        '"name":"Example Learner"',
        '"name":"Example Learner","name":"Ex"',
      );
      expect(() => readStatementJson(text)).toThrow('The text has the property "name" twice in actor');
    });

    it("refuses a text that repeats a property, for any text of an object with a repeated name", () => {
      fc.assert(
        fc.property(fc.string(), fc.jsonValue(), fc.jsonValue(), (name, first, second) => {
          const text = `{${JSON.stringify(name)}:${JSON.stringify(first)},${JSON.stringify(name)}:${JSON.stringify(second)}}`;
          expect(() => readStatementJson(text)).toThrow(DataError);
        }),
        RUNS,
      );
    });
  });

  describe("a property named __proto__", () => {
    it("is a property of the result and changes no prototype", () => {
      const result = readStatementJson('{"__proto__":{"polluted":true},"a":1}') as Record<string, unknown>;
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.keys(result)).toStrictEqual(["__proto__", "a"]);
      expect((result as { polluted?: boolean }).polluted).toBeUndefined();
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });
  });

  describe("text that is not JSON", () => {
    it.each([
      "",
      " ",
      "{",
      '{"a":}',
      "[1,]",
      '{"a":1,}',
      "NaN",
      "Infinity",
      "'a'",
      "{'a':1}",
      "01",
      "+1",
      "1.",
      ".5",
      "0x10",
      "// comment\n1",
      "/* comment */ 1",
      "{} {}",
      "1 2",
      "﻿{}",
      "undefined",
      "nul",
      '"unterminated',
      '"\\x"',
      '"a\tb"',
      '"a\nb"',
    ])("refuses %j with a sentence", (text) => {
      expect(() => readStatementJson(text)).toThrow(DataError);
      expect(() => readStatementJson(text)).toThrow(/^The text is not valid JSON: /);
    });

    it("refuses any text that JSON.parse refuses, and reads any text that it reads", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string({ unit: "binary" }),
            fc
              .array(
                fc.constantFrom("{", "}", "[", "]", ",", ":", '"', "1", "a", "true", "null", " ", "\\", "\n", "\t"),
              )
              .map((tokens) => tokens.join("")),
          ),
          (text) => {
            let expected: unknown;
            let valid = true;
            try {
              expected = JSON.parse(text);
            } catch {
              valid = false;
            }
            if (!valid) {
              expect(() => readStatementJson(text)).toThrow(/^The text is not valid JSON: /);
              return;
            }
            // A text of valid JSON is read, unless an object in it repeats a property.
            try {
              expect(readStatementJson(text)).toStrictEqual(expected);
            } catch (error) {
              expect(String(error)).toContain(" twice");
            }
          },
        ),
        RUNS,
      );
    });

    it("refuses what is not a string", () => {
      for (const value of [null, undefined, 5, {}, []] as unknown[]) {
        expect(() => readStatementJson(value as string)).toThrow(DataError);
        expect(() => readStatementJson(value as string)).toThrow(/^The text must be a string, found /);
      }
    });
  });

  describe("the limits", () => {
    it("counts the bytes of the text and not its characters, and refuses the text above the limit", () => {
      expect(readStatementJson('"€€"', { maxBytes: 8 })).toBe("€€");
      expect(() => readStatementJson('"€€€"', { maxBytes: 8 })).toThrow(
        "The text has 11 bytes or more, above the limit of 8 bytes.",
      );
      expect(readStatementJson("[1,2,3]", { maxBytes: 7 })).toStrictEqual([1, 2, 3]);
      expect(() => readStatementJson("[1,2,3]", { maxBytes: 6 })).toThrow(DataError);
    });

    it("refuses 10 MiB and one more byte without reading it", () => {
      expect(() => readStatementJson(" ".repeat(10_485_761))).toThrow("above the limit of 10485760 bytes");
    });

    it("reads nesting up to the depth and refuses one level more", () => {
      expect(readStatementJson("[[[]]]", { maxDepth: 3 })).toStrictEqual([[[]]]);
      expect(() => readStatementJson("[[[[]]]]", { maxDepth: 3 })).toThrow(
        "The text nests arrays and objects deeper than the limit of 3 levels.",
      );
      expect(() => readStatementJson('{"a":{"b":{"c":{}}}}', { maxDepth: 3 })).toThrow("deeper than the limit of 3");
    });

    it("reads 64 levels unless told otherwise, and refuses 65", () => {
      expect(readStatementJson("[".repeat(64) + "]".repeat(64))).toBeInstanceOf(Array);
      expect(() => readStatementJson("[".repeat(65) + "]".repeat(65))).toThrow("deeper than the limit of 64");
    });

    it("counts the tokens of the text and refuses the text above the limit", () => {
      expect(readStatementJson("[1,2,3]", { maxTokens: 7 })).toStrictEqual([1, 2, 3]);
      expect(() => readStatementJson("[1,2,3]", { maxTokens: 6 })).toThrow(
        "The text has more than 6 tokens, above the limit of the option maxTokens.",
      );
      expect(readStatementJson('{"a":[true,null,-1.5e+2,"x"]}', { maxTokens: 13 })).toStrictEqual({
        a: [true, null, -150, "x"],
      });
      expect(() => readStatementJson('{"a":[true,null,-1.5e+2,"x"]}', { maxTokens: 12 })).toThrow(DataError);
    });

    it("reads the most tokens by default, 1,000,000, and refuses one more", () => {
      const atTheLimit = `[${"0,".repeat(499_998)}[]]`;
      expect(tokenize(atTheLimit, { mode: "json" })).toHaveLength(1_000_000);
      expect(readStatementJson(atTheLimit)).toHaveLength(499_999);
      const oneMore = `[${"0,".repeat(499_999)}0]`;
      expect(tokenize(oneMore, { mode: "json" })).toHaveLength(1_000_001);
      expect(() => readStatementJson(oneMore)).toThrow("The text has more than 1000000 tokens");
    });

    it("refuses the text of 10 MiB that has the most tokens, the worst for memory, before it builds the tree", async () => {
      // Each byte is a token, and a syntax tree of the text takes over 1 GB.
      const worst = `[${"0,".repeat(5_242_878)}0]`;
      expect(worst.length).toBe(10_485_759);
      vi.resetModules();
      const parse = vi.fn(() => {
        throw new Error("the syntax tree was built");
      });
      vi.doMock("@humanwhocodes/momoa", () => ({ parse }));
      try {
        const { readStatementJson: withSpy } = await import("../src/index.js");
        // The module is imported again, so its DataError is not the class of this file: the message is the evidence.
        expect(() => withSpy(worst)).toThrow("The text has more than 1000000 tokens");
        expect(parse).not.toHaveBeenCalled();
      } finally {
        vi.doUnmock("@humanwhocodes/momoa");
        vi.resetModules();
      }
    });

    it("refuses a hundred thousand opening brackets before it parses anything", () => {
      expect(() => readStatementJson("[".repeat(100_000))).toThrow("deeper than the limit of 64");
      expect(() => readStatementJson('{"a":'.repeat(50_000))).toThrow("deeper than the limit of 64");
    });

    it("refuses a depth that the parser cannot hold, with a sentence and not a stack overflow", () => {
      const levels = 200_000;
      const text = "[".repeat(levels) + "]".repeat(levels);
      expect(() => readStatementJson(text, { maxDepth: levels })).toThrow(DataError);
      expect(() => readStatementJson(text, { maxDepth: levels })).toThrow("the limit of 200000 levels is too high");
    });

    it.each([
      [null, "The options object is invalid: expected an object, found null."],
      [[], "The options object is invalid: expected an object, found an array."],
      [{ maxBytes: 0 }, "The options object is invalid at maxBytes: expected a value of at least 1, found 0."],
      [{ maxBytes: "10" }, 'The options object is invalid at maxBytes: expected a number, found "10".'],
      [{ maxDepth: 1.5 }, "The options object is invalid at maxDepth: expected a safe integer, found 1.5."],
      [{ maxDepth: -1 }, "The options object is invalid at maxDepth: expected a value of at least 1, found -1."],
      [{ maxTokens: 0 }, "The options object is invalid at maxTokens: expected a value of at least 1, found 0."],
      [{ maxTokens: "10" }, 'The options object is invalid at maxTokens: expected a number, found "10".'],
      [{ limit: 1 }, 'The options object is invalid: unexpected property "limit".'],
    ])("refuses the options %j", (options, sentence) => {
      const given = JSON.parse(JSON.stringify(options));
      expect(() => readStatementJson("{}", given)).toThrow(new DataError(sentence));
    });
  });

  it("does not hide an error of the parser that is not about depth", async () => {
    vi.resetModules();
    vi.doMock("@humanwhocodes/momoa", () => ({
      parse: () => {
        throw new TypeError("a defect of the parser");
      },
    }));
    try {
      const { readStatementJson: withBrokenParser } = await import("../src/index.js");
      expect(() => withBrokenParser("{}")).toThrow(new TypeError("a defect of the parser"));
    } finally {
      vi.doUnmock("@humanwhocodes/momoa");
      vi.resetModules();
    }
  });
});
