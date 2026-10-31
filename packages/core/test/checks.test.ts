import fc from "fast-check";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import {
  checkAbortSignal,
  checkArray,
  checkFunction,
  checkHttpsUrl,
  checkNonEmptyString,
  checkNonNegativeInteger,
  checkPositiveInteger,
  checkProperties,
  checkRecord,
  checkString,
  describe as describeValue,
  finiteSchema,
  guardSchema,
  httpsUrlSchema,
  isRecord,
  issueText,
  looseRecord,
  mapSchema,
  methodsSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  parseWith,
  positiveIntegerSchema,
  positiveSchema,
} from "../src/checks.js";
import { DataError } from "../src/index.js";

describe("describe", () => {
  it("quotes strings and names arrays, functions and objects", () => {
    expect(describeValue("a")).toBe('"a"');
    expect(describeValue([1])).toBe("an array");
    expect(describeValue(() => 1)).toBe("a function");
    expect(describeValue({})).toBe("an object");
    expect(describeValue(null)).toBe("null");
    expect(describeValue(undefined)).toBe("undefined");
    expect(describeValue(1.5)).toBe("1.5");
  });
});

describe("isRecord", () => {
  it("accepts objects that are neither null nor arrays", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("a")).toBe(false);
  });
});

describe("checkRecord", () => {
  it("accepts a record and rejects other values with the given message", () => {
    expect(() => checkRecord({}, "The options must be an object")).not.toThrow();
    expect(() => checkRecord(JSON.parse("null"), "The options must be an object")).toThrow(
      new DataError("The options must be an object, found null."),
    );
    expect(() => checkRecord(JSON.parse("[]"), "The options must be an object")).toThrow(DataError);
  });
});

describe("checkArray", () => {
  it("accepts an array and rejects other values", () => {
    expect(() => checkArray([], "The roles must be an array")).not.toThrow();
    expect(() => checkArray(JSON.parse("{}"), "The roles must be an array")).toThrow(
      "The roles must be an array, found an object.",
    );
  });
});

describe("checkFunction", () => {
  it("accepts a function and rejects other values", () => {
    expect(() => checkFunction(() => 1, "The registration must be a function")).not.toThrow();
    expect(() => checkFunction(JSON.parse('"x"'), "The registration must be a function")).toThrow(
      'The registration must be a function, found "x".',
    );
  });
});

describe("checkProperties", () => {
  it("accepts a record with some or all of the properties, and one with none", () => {
    expect(() => checkProperties({}, "A score", ["a", "b"])).not.toThrow();
    expect(() => checkProperties({ a: 1 }, "A score", ["a", "b"])).not.toThrow();
    expect(() => checkProperties({ a: 1, b: 2 }, "A score", ["a", "b"])).not.toThrow();
  });

  it("names the properties a record may have and the one it has too many", () => {
    expect(() => checkProperties({ a: 1, extra: "s" }, "A score", ["a", "b"])).toThrow(
      new DataError('A score has the properties "a" and "b", found "extra".'),
    );
    expect(() => checkProperties({ c: 1 }, "A score", ["a", "b", "d"])).toThrow(
      'A score has the properties "a", "b" and "d", found "c".',
    );
  });

  it("names the one property that a record may have in the singular", () => {
    expect(() => checkProperties({ b: 1 }, "The options", ["a"])).toThrow(
      new DataError('The options has the property "a", found "b".'),
    );
  });

  it("treats a property named __proto__ as data", () => {
    const record: Readonly<Record<string, unknown>> = JSON.parse('{"__proto__": 1}');
    expect(() => checkProperties(record, "A score", ["a", "b"])).toThrow('found "__proto__".');
  });
});

describe("checkString", () => {
  it("accepts a string and rejects other values", () => {
    expect(() => checkString("", "The address")).not.toThrow();
    expect(() => checkString(JSON.parse("1"), "The address")).toThrow("The address must be a string, found 1.");
  });
});

describe("checkNonEmptyString", () => {
  it("accepts a string of at least one character", () => {
    expect(() => checkNonEmptyString("s", "The client id")).not.toThrow();
  });

  it("rejects the empty string and other values", () => {
    expect(() => checkNonEmptyString("", "The client id")).toThrow(
      new DataError('The client id must be a non-empty string, found "".'),
    );
    expect(() => checkNonEmptyString(JSON.parse("[]"), "The client id")).toThrow("found an array.");
  });
});

describe("checkHttpsUrl", () => {
  it("accepts an absolute https URL", () => {
    expect(() => checkHttpsUrl("https://platform.example/jwks?x=1", "The option endpoint")).not.toThrow();
  });

  it("rejects other schemes, relative addresses, text and other values, and names the value", () => {
    for (const value of ["http://platform.example/", "/jwks", "platform.example", "javascript:alert(1)", "", 5, null]) {
      expect(() => checkHttpsUrl(value, "The option endpoint")).toThrow(DataError);
    }
    expect(() => checkHttpsUrl("http://platform.example/", "The option endpoint")).toThrow(
      'The option endpoint must be an absolute https URL, found "http://platform.example/".',
    );
    expect(() => checkHttpsUrl(5, "The option endpoint")).toThrow("The option endpoint must be a string, found 5.");
  });
});

describe("checkNonNegativeInteger", () => {
  it("accepts safe integers from 0", () => {
    expect(() => checkNonNegativeInteger(0, "The count")).not.toThrow();
    for (const value of [-1, 1.5, 2 ** 53, "1"]) {
      expect(() => checkNonNegativeInteger(value, "The count")).toThrow(DataError);
    }
    expect(() => checkNonNegativeInteger(-1, "The count")).toThrow(
      "The count must be a non-negative integer, found -1.",
    );
  });
});

describe("checkPositiveInteger", () => {
  it("accepts safe integers from 1", () => {
    expect(() => checkPositiveInteger(1, "The option timeoutMs")).not.toThrow();
    for (const value of [0, -1, 1.5, 2 ** 53, "1"]) {
      expect(() => checkPositiveInteger(value, "The option timeoutMs")).toThrow(DataError);
    }
    expect(() => checkPositiveInteger(0, "The option timeoutMs")).toThrow(
      "The option timeoutMs must be a positive integer, found 0.",
    );
  });
});

describe("checkAbortSignal", () => {
  it("accepts an AbortSignal and rejects other values", () => {
    expect(() => checkAbortSignal(new AbortController().signal, "The option signal")).not.toThrow();
    expect(() => checkAbortSignal(AbortSignal.abort(), "The option signal")).not.toThrow();
    expect(() => checkAbortSignal(JSON.parse('{"aborted":false}'), "The option signal")).toThrow(
      new DataError("The option signal must be an AbortSignal, found an object."),
    );
    expect(() => checkAbortSignal(JSON.parse("null"), "The option signal")).toThrow("found null.");
  });
});

describe("parseWith", () => {
  const schema = v.strictObject({
    name: v.string(),
    count: nonNegativeIntegerSchema,
    kind: v.picklist(["a", "b", "c"]),
    items: v.array(v.strictObject({ id: v.string() })),
  });
  const valid = { name: "n", count: 2, kind: "a", items: [{ id: "x" }] };
  const message = (input: unknown): string => {
    try {
      parseWith(schema, input, "The thing");
    } catch (error) {
      if (error instanceof DataError) return error.message;
      throw error;
    }
    return "";
  };

  it("returns the output of the schema", () => {
    expect(parseWith(schema, valid, "The thing")).toEqual(valid);
  });

  it("names the path and what was expected and found, in a full sentence", () => {
    expect(message(JSON.parse("null"))).toBe("The thing is invalid: expected an object, found null.");
    expect(message({ ...valid, name: 5 })).toBe("The thing is invalid at name: expected a string, found 5.");
    expect(message({ ...valid, count: -1 })).toBe(
      "The thing is invalid at count: expected a value of at least 0, found -1.",
    );
    expect(message({ ...valid, count: 1.5 })).toBe(
      "The thing is invalid at count: expected a safe integer, found 1.5.",
    );
    expect(message({ ...valid, kind: "z" })).toBe('The thing is invalid at kind: expected "a", "b" or "c", found "z".');
    expect(message({ ...valid, items: [{ id: 1 }] })).toBe(
      "The thing is invalid at items[0].id: expected a string, found 1.",
    );
    expect(message({ ...valid, items: {} })).toBe("The thing is invalid at items: expected an array, found an object.");
  });

  it("names a property that is missing or unexpected, at its object", () => {
    expect(message({ ...valid, count: undefined })).toBe(
      "The thing is invalid at count: expected a number, found undefined.",
    );
    expect(message({ name: "n", kind: "a", items: [] })).toBe('The thing is invalid: missing the property "count".');
    expect(message({ ...valid, extra: 1 })).toBe('The thing is invalid: unexpected property "extra".');
    expect(message({ ...valid, items: [{ id: "x", more: true }] })).toBe(
      'The thing is invalid at items[0]: unexpected property "more".',
    );
    const withProto: unknown = JSON.parse(JSON.stringify(valid).replace("{", '{"__proto__":1,'));
    expect(message(withProto)).toBe('The thing is invalid: unexpected property "__proto__".');
  });

  it("writes a name that is not an identifier in brackets, and uses the message of a rule", () => {
    const named = v.strictObject({
      "a b": v.pipe(
        v.string(),
        v.check((text) => text === "ok", "must be ok"),
      ),
    });
    expect(() => parseWith(named, { "a b": "no" }, "The input")).toThrow(
      new DataError('The input is invalid at ["a b"]: must be ok.'),
    );
  });

  it("names an unexpected element of a tuple and a single expected value", () => {
    expect(() => parseWith(v.strictTuple([v.string()]), ["a", "b"], "The pair")).toThrow(
      new DataError("The pair is invalid at [1]: unexpected element."),
    );
    expect(() => parseWith(v.literal("code"), "token", "The response type")).toThrow(
      new DataError('The response type is invalid: expected "code", found "token".'),
    );
  });

  it("throws nothing but a DataError, whatever JSON it reads", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (input) => {
        try {
          parseWith(schema, JSON.parse(JSON.stringify(input)), "The thing");
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
        }
      }),
      { seed: 20_261_101, numRuns: 300 },
    );
  });
});

describe("issueText", () => {
  it("gives the text of an issue with its path", () => {
    const schema = v.strictObject({ items: v.array(v.strictObject({ id: v.string() })) });
    const [issue] = v.safeParse(schema, { items: [{ id: 1 }] }).issues ?? [];
    expect(issue === undefined ? "" : issueText(issue)).toBe("items[0].id: expected a string, found 1");
  });

  it("gives the text alone for an issue at the root", () => {
    const [issue] = v.safeParse(v.string(), 5).issues ?? [];
    expect(issue === undefined ? "" : issueText(issue)).toBe("expected a string, found 5");
  });
});

describe("looseRecord", () => {
  it("keeps the properties it does not know, and refuses an array whatever the entries", () => {
    const options = looseRecord({ speed: v.optional(v.number()) });
    expect(parseWith(options, { speed: 1, extra: true }, "The options")).toEqual({ speed: 1, extra: true });
    expect(parseWith(options, {}, "The options")).toEqual({});
    expect(() => parseWith(options, [], "The options")).toThrow(
      new DataError("The options is invalid: expected an object, found an array."),
    );
  });
});

describe("mapSchema", () => {
  const claims = mapSchema(v.string());

  it("reads every own property into a map, a property named __proto__ included", () => {
    const parsed = parseWith(claims, JSON.parse('{"a": "x", "__proto__": "y"}'), "The claims");
    expect([...parsed]).toStrictEqual([
      ["a", "x"],
      ["__proto__", "y"],
    ]);
  });

  it("names the path inside a property whose value is an object", () => {
    const nested = mapSchema(v.strictObject({ id: v.string() }));
    expect(() => parseWith(nested, { first: { id: 1 } }, "The claims")).toThrow(
      new DataError('The claims is invalid: the property "first" at id is invalid: expected a string, found 1.'),
    );
  });

  it("names the property whose value is not valid", () => {
    expect(() => parseWith(claims, { sub: 5 }, "The claims")).toThrow(
      new DataError('The claims is invalid: the property "sub" is invalid: expected a string, found 5.'),
    );
    expect(() => parseWith(claims, [], "The claims")).toThrow("expected an object, found an array");
  });
});

describe("guardSchema", () => {
  it("passes on a value that the guard accepts and describes what it expected otherwise", () => {
    const text = guardSchema((value): value is string => typeof value === "string", "some text");
    expect(parseWith(text, "x", "The value")).toBe("x");
    expect(() => parseWith(text, 5, "The value")).toThrow(
      new DataError("The value is invalid: expected some text, found 5."),
    );
  });
});

describe("methodsSchema", () => {
  it("accepts an object that has the functions, a class instance included", () => {
    class Store {
      get(): void {}
      put(): void {}
    }
    const store = new Store();
    expect(parseWith(methodsSchema<Store>("get", "put"), store, "The store")).toBe(store);
  });

  it("says which functions an object needs", () => {
    expect(() => parseWith(methodsSchema<{ get(): void; put(): void }>("get", "put"), { get: 1 }, "The store")).toThrow(
      new DataError("The store is invalid: expected an object with the functions get and put, found an object."),
    );
    expect(() => parseWith(methodsSchema<{ now(): number }>("now"), {}, "The clock")).toThrow(
      "expected an object with the function now, found an object",
    );
  });
});

describe("the schemas of numbers and strings", () => {
  it("accept finite numbers only", () => {
    expect(parseWith(finiteSchema, -1.5, "The value")).toBe(-1.5);
    expect(() => parseWith(finiteSchema, Number.POSITIVE_INFINITY, "The value")).toThrow(DataError);
  });

  it("accept an absolute https URL only", () => {
    expect(parseWith(httpsUrlSchema, "https://platform.example/", "The value")).toBe("https://platform.example/");
    expect(() => parseWith(httpsUrlSchema, "http://platform.example/", "The value")).toThrow(
      new DataError('The value is invalid: expected an absolute https URL, found "http://platform.example/".'),
    );
  });

  it("accept a string of at least one character only", () => {
    expect(parseWith(nonEmptyStringSchema, "a", "The value")).toBe("a");
    expect(() => parseWith(nonEmptyStringSchema, "", "The value")).toThrow(DataError);
  });

  it("accept safe integers from 0 or from 1", () => {
    expect(parseWith(nonNegativeIntegerSchema, 0, "The value")).toBe(0);
    expect(() => parseWith(nonNegativeIntegerSchema, -1, "The value")).toThrow(DataError);
    expect(parseWith(positiveIntegerSchema, 1, "The value")).toBe(1);
    expect(() => parseWith(positiveIntegerSchema, 0, "The value")).toThrow(DataError);
  });

  it("accept a finite number above 0 only", () => {
    expect(parseWith(positiveSchema, 0.5, "The value")).toBe(0.5);
    expect(() => parseWith(positiveSchema, 0, "The value")).toThrow(
      new DataError("The value is invalid: expected a positive number, found 0."),
    );
  });
});
