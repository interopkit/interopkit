import { type AnyNode, evaluate, parse, tokenize } from "@humanwhocodes/momoa";
import { DataError, LimitError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { readStatement, readStatementJson, validateStatements } from "../src/index.js";
import { fullStatement, minimalStatement } from "./full-statement.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_102, numRuns: 300 };

/** What momoa, a parser that builds a syntax tree, finds as the first repeated property of a text, written as the error names it. */
function repeatOfTree(node: AnyNode, path: string): string | undefined {
  if (node.type === "Array") {
    for (const [index, element] of node.elements.entries()) {
      const found = repeatOfTree(element.value, `${path}[${index}]`);
      if (found !== undefined) return found;
    }
  }
  if (node.type !== "Object") return undefined;
  const seen = new Set<string>();
  for (const entry of node.members) {
    const name = String(evaluate(entry.name));
    if (seen.has(name)) {
      const where = path === "" ? "" : ` in ${path}`;
      return `${JSON.stringify(name)} twice${where}, at line ${entry.loc.start.line} column ${entry.loc.start.column}`;
    }
    seen.add(name);
    const found = repeatOfTree(entry.value, path === "" ? name : `${path}.${name}`);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Writes a value of JSON as text, with white space and escapes between its tokens, and a name of an object that may repeat. */
const jsonText: fc.Arbitrary<string> = fc.letrec<{ value: string }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constantFrom(
      "0",
      "true",
      "null",
      '"text"',
      String.raw`"a\\"`,
      String.raw`"\\"`,
      String.raw`"\"quoted\""`,
      '"{"',
      '"]"',
      '","',
    ),
    fc
      .array(tie("value"), { maxLength: 4 })
      .chain((items) =>
        fc
          .constantFrom(" ", "\n", "\r\n", "\r", "\t", "")
          .map((space) => `[${space}${items.join(`,${space}`)}${space}]`),
      ),
    fc
      .array(
        fc.tuple(
          fc.constantFrom('"a"', '"b"', String.raw`"\u0061"`, String.raw`"a\\"`, String.raw`"\""`, '"x y"'),
          tie("value"),
        ),
        { maxLength: 4 },
      )
      .chain((members) =>
        fc
          .constantFrom(" ", "\n", "\r\n", "\r", "\t", "")
          .map((space) => `{${space}${members.map(([name, value]) => `${name}${space}:${value}`).join(`,${space}`)}}`),
      ),
  ),
})).value;

describe("readStatementJson", () => {
  it("finds the first repeated property where a parser that builds a syntax tree finds it", () => {
    fc.assert(
      fc.property(jsonText, (text) => {
        const repeat = repeatOfTree(parse(text, { mode: "json" }).body, "");
        if (repeat === undefined) expect(readStatementJson(text)).toStrictEqual(JSON.parse(text));
        else expect(() => readStatementJson(text)).toThrow(`The text has the property ${repeat}.`);
      }),
      { ...RUNS, numRuns: 2000 },
    );
  });

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
      // Two brackets, two tokens for each "0,", and the two of the inner []: 2 + 2 * 499,998 + 2 = 1,000,000.
      const atTheLimit = `[${"0,".repeat(499_998)}[]]`;
      expect(readStatementJson(atTheLimit)).toHaveLength(499_999);
      // Two brackets, two tokens for each "0,", and the last 0: 2 + 2 * 499,999 + 1 = 1,000,001.
      const oneMore = `[${"0,".repeat(499_999)}0]`;
      expect(() => readStatementJson(oneMore)).toThrow("The text has more than 1000000 tokens");
    });

    it("counts the tokens as a tokenizer does", () => {
      const text = '[0,{"a":[true,null,-1.5e+2,"x\\"y"]},[], "z" ]';
      const count = tokenize(text, { mode: "json" }).length;
      expect(readStatementJson(text, { maxTokens: count })).toStrictEqual(JSON.parse(text));
      expect(() => readStatementJson(text, { maxTokens: count - 1 })).toThrow(`more than ${count - 1} tokens`);
    });

    it("refuses the text of 10 MiB that has the most tokens, the worst for memory, before it parses anything", () => {
      const worst = `[${"0,".repeat(5_242_878)}0]`;
      expect(worst.length).toBe(10_485_759);
      const parse = vi.spyOn(JSON, "parse");
      try {
        expect(() => readStatementJson(worst)).toThrow("The text has more than 1000000 tokens");
        expect(parse).not.toHaveBeenCalled();
      } finally {
        parse.mockRestore();
      }
    });

    it("refuses a text over both limits for its depth, whichever it passes first", () => {
      // The fifth token passes a limit of four tokens before the brackets pass the depth of three.
      expect(() => readStatementJson("[1,2,[[[[]]]]]", { maxDepth: 3, maxTokens: 4 })).toThrow(
        "The text nests arrays and objects deeper than the limit of 3 levels.",
      );
      expect(() => readStatementJson("[[[[1,2,3]]]]", { maxDepth: 3, maxTokens: 4 })).toThrow(
        "The text nests arrays and objects deeper than the limit of 3 levels.",
      );
    });

    it("refuses a hundred thousand opening brackets before it parses anything", () => {
      expect(() => readStatementJson("[".repeat(100_000))).toThrow("deeper than the limit of 64");
      expect(() => readStatementJson('{"a":'.repeat(50_000))).toThrow("deeper than the limit of 64");
    });

    it("names the limit that a text went over and its value, so that a handler can answer 413", () => {
      const over = (text: string, options: object) => {
        try {
          readStatementJson(text, options);
        } catch (error) {
          return error;
        }
        return undefined;
      };
      expect(over("[1,2,3]", { maxTokens: 2 })).toMatchObject({ name: "LimitError", limit: "maxTokens", maximum: 2 });
      expect(over("[1,2,3]", { maxBytes: 2 })).toMatchObject({ name: "LimitError", limit: "maxBytes", maximum: 2 });
      expect(over("[[1]]", { maxDepth: 1 })).toMatchObject({ name: "LimitError", limit: "maxDepth", maximum: 1 });
      expect(over("[1,2,3]", { maxBytes: 2 })).toBeInstanceOf(DataError);
      expect(over("[1,", {})).not.toBeInstanceOf(LimitError);
      expect((over("[1,", {}) as DataError).cause).toBeInstanceOf(SyntaxError);
    });

    it("reads a depth above the stack when the caller allows it, since the search for a repeat does not recurse", () => {
      const levels = 2_000;
      const text = `${'{"a":'.repeat(levels)}1${"}".repeat(levels)}`;
      expect(() => readStatementJson(text, { maxDepth: levels })).not.toThrow();
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
});
