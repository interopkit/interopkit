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
  checkRemoteUrl,
  checkString,
  dateTimeSchema,
  describe as describeValue,
  findingsOf,
  finiteSchema,
  guardSchema,
  httpsUrlSchema,
  isRecord,
  issueText,
  jsonObjectSchema,
  looseRecord,
  mapSchema,
  methodsSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  openRecord,
  parseWith,
  pathOf,
  positiveIntegerSchema,
  positiveSchema,
  refusalOf,
  remoteUrlSchema,
  strictRecord,
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

describe("checkRemoteUrl", () => {
  it("accepts an https URL that names a public host, with a port, a path, a query or a final dot", () => {
    for (const value of [
      "https://lms.example.edu/api/lti/courses/1/line_items?limit=10",
      "https://platform.example:8443/jwks",
      "https://lms.example.edu./scores",
      "https://xn--bcher-kva.example/",
    ]) {
      expect(() => checkRemoteUrl(value, "The line item")).not.toThrow();
    }
  });

  it("refuses an IP address in every spelling that the URL parser reads", () => {
    for (const value of [
      "https://127.0.0.1/",
      "https://2130706433/",
      "https://0x7f.1/",
      "https://0177.0.0.1/",
      "https://127.1/",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.8:8443/",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[fd00:ec2::254]/",
    ]) {
      expect(() => checkRemoteUrl(value, "The line item"), value).toThrow("which names its host by an IP address.");
    }
  });

  it("refuses a single label, and the names of loopback, link-local, home and private networks", () => {
    for (const value of ["https://localhost/", "https://LOCALHOST./", "https://intranet/", "https://metadata/"]) {
      expect(() => checkRemoteUrl(value, "The line item"), value).toThrow("which names its host by a single label.");
    }
    for (const value of [
      "https://api.localhost/",
      "https://printer.local/",
      "https://router.home.arpa/",
      "https://grades.corp.internal/",
      "https://lms.internal./",
    ]) {
      expect(() => checkRemoteUrl(value, "The line item"), value).toThrow("which names a host of a private network.");
    }
  });

  it("refuses user information, another scheme and what is not a URL, and names the value", () => {
    expect(() => checkRemoteUrl("https://user:secret@lms.example.edu/", "The line item")).toThrow(
      new DataError(
        'The line item must be an https URL that names a public host, found "https://user:secret@lms.example.edu/", which has user information.',
      ),
    );
    expect(() => checkRemoteUrl("https://user@lms.example.edu/", "The line item")).toThrow("has user information.");
    expect(() => checkRemoteUrl("http://lms.example.edu/", "The line item")).toThrow("which is not https.");
    expect(() => checkRemoteUrl("/scores", "The line item")).toThrow("which is not an absolute URL.");
    expect(() => checkRemoteUrl(JSON.parse("5"), "The line item")).toThrow(
      new DataError("The line item must be a string, found 5."),
    );
  });

  it("accepts with its schema what it accepts, and refuses with its schema what it refuses", () => {
    expect(parseWith(remoteUrlSchema, "https://lms.example.edu/", "The value")).toBe("https://lms.example.edu/");
    expect(() => parseWith(remoteUrlSchema, "https://0x7f.1/", "The value")).toThrow(
      new DataError(
        'The value is invalid: expected an https URL that names a public host, found "https://0x7f.1/", which names its host by an IP address.',
      ),
    );
    expect(() => parseWith(remoteUrlSchema, JSON.parse("null"), "The value")).toThrow(DataError);
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ["https", "http"], withQueryParameters: true }),
        fc.string(),
        (url, text) => {
          for (const value of [url, text]) {
            let thrown = false;
            try {
              checkRemoteUrl(value, "The value");
            } catch {
              thrown = true;
            }
            expect(v.safeParse(remoteUrlSchema, value).success).toBe(!thrown);
          }
        },
      ),
      { seed: 20_261_102, numRuns: 300 },
    );
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

describe("pathOf", () => {
  it("writes a path as code does: names after a dot, indexes in brackets, other names quoted", () => {
    const schema = v.strictObject({ items: v.array(v.record(v.string(), v.string())) });
    const [issue] = v.safeParse(schema, { items: [{ "a-b": 1 }] }).issues ?? [];
    expect(pathOf(issue?.path)).toBe('items[0]["a-b"]');
  });

  it("gives the empty string for the value as a whole", () => {
    expect(pathOf(undefined)).toBe("");
  });
});

const findingsSchema = strictRecord({
  name: v.string(),
  count: v.optional(v.pipe(v.number(), v.integer())),
  list: v.optional(v.pipe(v.array(v.string()), v.minLength(1))),
  kind: v.optional(v.picklist(["a", "b"])),
  when: v.optional(dateTimeSchema),
  term: v.optional(guardSchema((value): value is "x" => value === "x", "x")),
  inner: v.optional(strictRecord({ id: v.string() })),
  items: v.optional(v.array(strictRecord({ name: v.string() }))),
  pair: v.optional(v.tupleWithRest([v.string()], v.number())),
});

/** The findings of a value that the schema above reads. */
function findingsOfValue(value: unknown) {
  return findingsOf(v.safeParse(findingsSchema, value).issues ?? []);
}

describe("findingsOf", () => {
  it.each([
    ["a value that is not an object", null, "", "wrong-type", "expected an object, found null."],
    ["an array where an object is", [], "", "wrong-type", "expected an object, found an array."],
    ["a missing property", {}, "name", "missing-property", 'missing the property "name".'],
    ["an unknown property", { name: "n", other: 1 }, "other", "unknown-property", 'unexpected property "other".'],
    ["a value of another type", { name: 5 }, "name", "wrong-type", "expected a string, found 5."],
    [
      "a number that is not an integer",
      { name: "n", count: 1.5 },
      "count",
      "wrong-type",
      "expected an integer, found 1.5.",
    ],
    [
      "a value outside a vocabulary",
      { name: "n", kind: "c" },
      "kind",
      "invalid-value",
      'expected "a" or "b", found "c".',
    ],
    ["a value that a guard refuses", { name: "n", term: "y" }, "term", "invalid-value", 'expected x, found "y".'],
    [
      "a list that is too short",
      { name: "n", list: [] },
      "list",
      "too-few-entries",
      "expected a length of at least 1, found 0.",
    ],
    [
      "a string of the wrong form",
      { name: "n", when: "2024-06-13" },
      "when",
      "invalid-format",
      'expected a date and time as RFC 3339, such as 2024-06-13T18:46:03+00:00, found "2024-06-13".',
    ],
    [
      "a property of an object in an object",
      { name: "n", inner: {} },
      "inner.id",
      "missing-property",
      'missing the property "id".',
    ],
    ["a tuple that is not a list", { name: "n", pair: "x" }, "pair", "wrong-type", 'expected an array, found "x".'],
    [
      "a property of an object in a list",
      { name: "n", items: [{ name: "a" }, { name: 2 }] },
      "items[1].name",
      "wrong-type",
      "expected a string, found 2.",
    ],
  ])("gives the path, the rule and a sentence for %s", (_name, value, path, rule, message) => {
    expect(findingsOfValue(value)).toStrictEqual([{ path, rule, message }]);
  });

  it("gives one finding for each issue, in order, and none for a value that is read", () => {
    expect(findingsOfValue({ name: "n" })).toStrictEqual([]);
    expect(findingsOfValue({ count: 1.5, kind: "c" }).map(({ path }) => path)).toStrictEqual(["name", "count", "kind"]);
  });

  it("does not repeat the path in the sentence", () => {
    for (const finding of findingsOfValue({ name: 5, inner: { id: 1 } })) {
      expect(finding.message).not.toContain(finding.path);
    }
  });
});

describe("findingsOf for a variant", () => {
  const schema = v.pipe(
    guardSchema(isRecord, "an object"),
    v.variant(
      "kind",
      [v.strictObject({ kind: v.literal("a") }), v.strictObject({ kind: v.optional(v.literal("b")) })],
      (issue) => `expected "a" or "b", found ${issue.received}`,
    ),
  );

  it("gives an invalid value, at the discriminator, for a kind that no option has", () => {
    expect(findingsOf(v.safeParse(schema, { kind: "c" }).issues ?? [])).toStrictEqual([
      { path: "kind", rule: "invalid-value", message: 'expected "a" or "b", found "c".' },
    ]);
  });

  it("reads an option whose discriminator is absent when the option allows that", () => {
    expect(v.safeParse(schema, {}).success).toBe(true);
  });
});

describe("refusalOf", () => {
  const first = { path: "actor", rule: "identifier-count", message: "needs one identifier." };
  const second = { path: "verb", rule: "missing-property", message: 'missing the property "id".' };

  it("names the path and the sentence of the first error", () => {
    expect(refusalOf("The statement", [first], "validateStatement")).toBe(
      "The statement is invalid at actor: needs one identifier.",
    );
  });

  it("leaves out the path of an error about the value as a whole", () => {
    expect(refusalOf("The statement", [{ ...first, path: "" }], "validateStatement")).toBe(
      "The statement is invalid: needs one identifier.",
    );
  });

  it("counts the other errors and names the function that lists them", () => {
    expect(refusalOf("The statement", [first, second], "validateStatement")).toBe(
      "The statement is invalid at actor: needs one identifier. 1 more error: validateStatement lists every finding.",
    );
    expect(refusalOf("The statement", [first, second, second], "validateStatement")).toContain("2 more errors: ");
  });

  it("says that there is an error when it is given none", () => {
    expect(refusalOf("The statement", [], "validateStatement")).toBe("The statement is invalid: it has an error.");
  });

  it("says that there may be more errors when the list stopped at its limit", () => {
    const stopped = { path: "", rule: "findings-stopped", message: "the check stopped." };
    expect(refusalOf("The statement", [first, second, stopped], "validateStatement")).toBe(
      "The statement is invalid at actor: needs one identifier. At least 1 more error: the check stopped at its limit, and validateStatement with a higher maxFindings lists more.",
    );
    expect(refusalOf("The statement", [first, stopped], "validateStatement")).toBe(
      "The statement is invalid at actor: needs one identifier. There may be more errors: the check stopped at its limit, and validateStatement with a higher maxFindings lists more.",
    );
  });
});

describe("strictRecord", () => {
  const schema = strictRecord({ id: v.string() });

  it("reads an object with the entries and refuses a property that it does not know, and an array", () => {
    expect(v.safeParse(schema, { id: "a" }).success).toBe(true);
    expect(v.safeParse(schema, { id: "a", extra: 1 }).success).toBe(false);
    expect(v.safeParse(strictRecord({ id: v.optional(v.string()) }), []).success).toBe(false);
  });

  it("reports one unknown property of an object", () => {
    expect(
      findingsOf(v.safeParse(schema, { id: "a", first: 1, second: 2 }).issues ?? []).map(({ path }) => path),
    ).toStrictEqual(["first"]);
  });
});

describe("openRecord", () => {
  const schema = openRecord({ id: v.string() });

  it("reads an object with the entries, keeps the properties it does not know, and refuses an array", () => {
    expect(v.safeParse(schema, { id: "a", extra: { n: [1] } }).output).toStrictEqual({ id: "a", extra: { n: [1] } });
    expect(v.safeParse(openRecord({ id: v.optional(v.string()) }), []).success).toBe(false);
    expect(v.safeParse(schema, {}).success).toBe(false);
  });

  it("copies the properties it does not know, so that the result shares nothing with the input", () => {
    const input = { id: "a", extra: { list: [1] } };
    const result = v.parse(schema, input);
    expect(result.extra).toStrictEqual(input.extra);
    expect(result.extra).not.toBe(input.extra);
  });

  it("refuses a property it does not know that is not JSON, and says which", () => {
    const issues = v.safeParse(schema, { id: "a", extra: { at: () => 1 } }).issues ?? [];
    expect(findingsOf(issues)).toStrictEqual([
      { path: "extra", rule: "invalid-value", message: "extra.at is a function, which JSON cannot hold." },
    ]);
  });

  it("does not carry a property named __proto__ and leaves the prototype of the result alone", () => {
    const result = v.safeParse(schema, JSON.parse('{"id":"a","__proto__":{"x":1},"constructor":2}')).output;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result).toStrictEqual({ id: "a" });
  });
});

describe("jsonObjectSchema", () => {
  it("reads an object of JSON into a copy", () => {
    const input = { a: [1, { b: null }] };
    const result = v.safeParse(jsonObjectSchema, input);
    expect(result.output).toStrictEqual(input);
    expect(result.output).not.toBe(input);
  });

  it.each([null, "x", [], 5])("refuses %j, which is not an object", (value) => {
    expect(v.safeParse(jsonObjectSchema, value).success).toBe(false);
  });

  it("refuses an object that holds what JSON cannot, with a finding that says where", () => {
    const issues = v.safeParse(jsonObjectSchema, { list: [{ at: () => 1 }] }).issues ?? [];
    expect(findingsOf(issues)).toStrictEqual([
      { path: "", rule: "invalid-value", message: "list[0].at is a function, which JSON cannot hold." },
    ]);
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
