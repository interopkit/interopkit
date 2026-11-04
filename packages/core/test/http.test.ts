import fc from "fast-check";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { parseWith } from "../src/checks.js";
import {
  basePathSchema,
  buildJsonResponse,
  buildPageLinks,
  buildStatusInfoResponse,
  checkHttpRequest,
  type HttpRequest,
  negotiate,
  type ReadJsonOptions,
  readAccessDecision,
  readBearerToken,
  readForm,
  readJson,
  readOffsetPage,
  readQuery,
  readText,
} from "../src/http/index.js";
import { DataError, LimitError } from "../src/index.js";

const encoder = new TextEncoder();
const FORM = { "content-type": "application/x-www-form-urlencoded" };
const FUZZ = { seed: 20_261_101, numRuns: 200 } as const;

/** Builds a request. A body given as text is encoded as UTF-8. */
function request(init: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}) {
  const { url = "https://tool.example/", method = "GET", headers = {}, body = "" } = init;
  return { method, url, headers, body: typeof body === "string" ? encoder.encode(body) : body } satisfies HttpRequest;
}

/** Checks that a function returns, or throws a `DataError`, and nothing else. */
function expectOutcome(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error instanceof DataError, String(error instanceof Error ? error.stack : error)).toBe(true);
  }
}

describe("basePathSchema", () => {
  const read = (path: unknown) => parseWith(basePathSchema, path, "The option basePath");

  it("writes a path as the URL of a request writes its path, so that one spelled outside ASCII and one percent-encoded are one", () => {
    expect(read("")).toBe("");
    expect(read("/xapi")).toBe("/xapi");
    expect(read("/tenant/a")).toBe("/tenant/a");
    expect(read("/café")).toBe("/caf%C3%A9");
    expect(read("/caf%C3%A9")).toBe("/caf%C3%A9");
    expect(read("/a/../b")).toBe("/b");
  });

  it("refuses a path that does not start with / or ends with one, and one whose dots leave /", () => {
    for (const path of ["xapi", "/", "/xapi/", "/a//b", "/a b", "/a?b", "/a#b", 5, null]) {
      expect(() => read(path), String(path)).toThrow(DataError);
    }
    expect(() => read("/xapi/..")).toThrow(
      'The option basePath is invalid: expected "" or a path that starts with / and does not end with /, found "/".',
    );
    expect(() => read("/xapi/.")).toThrow('found "/xapi/"');
  });
});

describe("checkHttpRequest", () => {
  it("accepts a request with a method, an absolute URL, a body of bytes and lower-case headers", () => {
    expect(() => checkHttpRequest(request({}))).not.toThrow();
    expect(() => checkHttpRequest(request({ body: new Uint8Array([0xff, 0, 1]) }))).not.toThrow();
  });

  it("names what is wrong with a request that is not one", () => {
    const bad: readonly [string, unknown][] = [
      ["The request must be an object, found null.", JSON.parse("null")],
      [
        "The method of the request must be a string, found 5.",
        { method: 5, url: "https://a.example/", headers: {}, body: new Uint8Array() },
      ],
      [
        'The URL of the request must be an absolute URL, found "/login".',
        { method: "GET", url: "/login", headers: {}, body: new Uint8Array() },
      ],
      [
        "The body of the request must be a Uint8Array, found null: encode text with a TextEncoder.",
        { method: "GET", url: "https://a.example/", headers: {}, body: JSON.parse("null") },
      ],
      [
        "The body of the request must be a Uint8Array, found an array: encode text with a TextEncoder.",
        { method: "GET", url: "https://a.example/", headers: {}, body: JSON.parse("[1]") },
      ],
      [
        "The headers of the request must be an object, found an array.",
        { method: "GET", url: "https://a.example/", headers: JSON.parse("[]"), body: new Uint8Array() },
      ],
      [
        'The header "cookie" of the request must be a string, found 5.',
        { method: "GET", url: "https://a.example/", headers: JSON.parse('{"cookie":5}'), body: new Uint8Array() },
      ],
      [
        'The header names of the request must be in lower case, found "Cookie".',
        { method: "GET", url: "https://a.example/", headers: JSON.parse('{"Cookie": "a=1"}'), body: new Uint8Array() },
      ],
    ];
    for (const [message, value] of bad) expect(() => checkHttpRequest(value), message).toThrow(new DataError(message));
  });

  it("does not repeat a text body in its message, since a body may hold a token", () => {
    const text = { method: "POST", url: "https://a.example/", headers: {}, body: JSON.parse('"id_token=secret"') };
    expect(() => checkHttpRequest(text)).toThrow(
      new DataError("The body of the request must be a Uint8Array, found a string: encode text with a TextEncoder."),
    );
  });

  it("throws nothing but a DataError for any JSON", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (json) => expectOutcome(() => checkHttpRequest(json))),
      FUZZ,
    );
  });
});

describe("the parameters of a query and a form", () => {
  it("reads the parameters of a query into a map, and refuses one that repeats", () => {
    const read = (query: string) => readQuery(request({ url: `https://tool.example/login?${query}` }));
    expect([...read("iss=a&login_hint=b")]).toStrictEqual([
      ["iss", "a"],
      ["login_hint", "b"],
    ]);
    expect(() => read("iss=a&iss=b")).toThrow(
      new DataError('The query of the request has the parameter "iss" more than once.'),
    );
  });

  it("reads a form of the right media type, with its parameters, and refuses another media type", () => {
    const post = (type: string, body: string) => request({ method: "POST", headers: { "content-type": type }, body });
    expect([...readForm(post("application/x-www-form-urlencoded; charset=UTF-8", "id_token=a&state=b"))]).toStrictEqual(
      [
        ["id_token", "a"],
        ["state", "b"],
      ],
    );
    expect([...readForm(post("application/x-www-form-urlencoded", "a=b+c&d=e%2Bf&g%2B=+"))]).toStrictEqual([
      ["a", "b c"],
      ["d", "e+f"],
      ["g+", " "],
    ]);
    expect(() => readForm(post("application/json", "{}"))).toThrow(
      'The content type of the request must be application/x-www-form-urlencoded, found "application/json".',
    );
    expect(() => readForm(request({ method: "POST", body: "a=1" }))).toThrow(
      "The content type of the request must be application/x-www-form-urlencoded, found undefined.",
    );
    expect(() => readForm(post("application/x-www-form-urlencoded", "a=1&a=2"))).toThrow(
      'The form of the request has the parameter "a" more than once.',
    );
  });

  it("reads a form of the most bytes, and refuses one of more with the size and the limit", () => {
    const post = (body: string) => request({ method: "POST", headers: FORM, body });
    expect([...readForm(post("a=1&b=22"), { maxBytes: 8 })]).toStrictEqual([
      ["a", "1"],
      ["b", "22"],
    ]);
    expect(() => readForm(post("a=1&b=223"), { maxBytes: 8 })).toThrow(
      new LimitError("The body of the request has 9 bytes, above the limit of 8 bytes.", "maxBytes", 8),
    );
    expect([...readForm(post("a=1&b=223"))]).toHaveLength(2);
  });

  it("refuses options of other types", () => {
    const form = request({ method: "POST", headers: FORM, body: "a=1" });
    expect(() => readForm(form, JSON.parse("null"))).toThrow(
      new DataError("The options of readForm must be an object, found null."),
    );
    expect(() => readForm(form, { maxBytes: JSON.parse('"8"') })).toThrow(
      new DataError('The option maxBytes must be a positive integer, found "8".'),
    );
    expect(() => readForm(form, { maxBytes: 0 })).toThrow(
      new DataError("The option maxBytes must be a positive integer, found 0."),
    );
  });

  it("decodes the percent-encoded UTF-8 of a form, and a plus as a space", () => {
    const form = readForm(request({ method: "POST", headers: FORM, body: "name=caf%C3%A9+au+lait&mark=%E2%82%AC" }));
    expect([...form]).toStrictEqual([
      ["name", "café au lait"],
      ["mark", "€"],
    ]);
  });

  it("refuses a form whose bytes are not UTF-8", () => {
    const body = new Uint8Array([0x61, 0x3d, 0xff]);
    expect(() => readForm(request({ method: "POST", headers: FORM, body }))).toThrow(
      new DataError("The body of the request must be UTF-8 text, and it holds bytes that are not UTF-8."),
    );
  });

  it("never throws anything but a DataError for any query and any form", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.string({ maxLength: 40 }), (text, type) => {
        expectOutcome(() => readQuery(request({ url: `https://tool.example/login?${text}` })));
        expectOutcome(() => readForm(request({ method: "POST", headers: { "content-type": type }, body: text })));
      }),
      FUZZ,
    );
  });

  it("never throws anything but a DataError for any bytes in a form", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 60 }), (body) => {
        expectOutcome(() => readForm(request({ method: "POST", headers: FORM, body })));
      }),
      FUZZ,
    );
  });
});

describe("readBearerToken", () => {
  it("returns the b64token of the bearer scheme, the scheme in any case and after one or more spaces", () => {
    const tokenOf = (authorization?: string) =>
      readBearerToken(request({ headers: authorization === undefined ? {} : { authorization } }));
    expect(tokenOf("Bearer abc.DEF-_~+/9")).toBe("abc.DEF-_~+/9");
    expect(tokenOf("bearer   abc==")).toBe("abc==");
    expect(tokenOf("BEARER abc")).toBe("abc");
    for (const header of [
      undefined,
      "",
      "Bearer",
      "Bearer ",
      "Basic abc",
      "Bearer a b",
      "Bearer abc=d",
      " Bearer abc",
      "Bearer\tabc",
    ]) {
      expect(tokenOf(header), String(header)).toBeUndefined();
    }
    // The scheme ends at a space, so a token written against it is no bearer token.
    expect(tokenOf(`Bearer${"abc"}`)).toBeUndefined();
  });
});

describe("readText", () => {
  it("decodes the UTF-8 of a body, and gives the empty string for an empty body", () => {
    expect(readText(request({ body: "café \u{1F600}" }))).toBe("café \u{1F600}");
    expect(readText(request({}))).toBe("");
  });

  it("drops a byte order mark at the start, and keeps one inside", () => {
    expect(readText(request({ body: new Uint8Array([0xef, 0xbb, 0xbf, 0x61]) }))).toBe("a");
    expect(readText(request({ body: new Uint8Array([0x61, 0xef, 0xbb, 0xbf]) }))).toBe("a﻿");
  });

  it.each([
    ["a byte that UTF-8 never uses", [0x61, 0xff]],
    ["a sequence that stops short", [0xe2, 0x82]],
    ["an overlong form of a slash", [0xc0, 0xaf]],
    ["a surrogate half", [0xed, 0xa0, 0x80]],
  ])("refuses %s, and does not replace it", (_name, bytes) => {
    expect(() => readText(request({ body: new Uint8Array(bytes) }))).toThrow(
      new DataError("The body of the request must be UTF-8 text, and it holds bytes that are not UTF-8."),
    );
  });

  it("returns the text that was encoded, for any text", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (text) => {
        expect(readText(request({ body: text }))).toBe(text.replace(/^﻿/u, ""));
      }),
      FUZZ,
    );
  });

  it("throws nothing but a DataError for any bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 60 }), (body) => expectOutcome(() => readText(request({ body })))),
      FUZZ,
    );
  });
});

describe("readJson", () => {
  const json = (text: string, options?: Parameters<typeof readJson>[1]) => readJson(request({ body: text }), options);
  const nested = (depth: number) => "[".repeat(depth) + "]".repeat(depth);

  it("parses the JSON of a body", () => {
    expect(json('{"a":[1,"b",null,true],"c":{"d":1.5}}')).toStrictEqual({ a: [1, "b", null, true], c: { d: 1.5 } });
    expect(json(" 7 ")).toBe(7);
    expect(json('"text"')).toBe("text");
  });

  it("refuses a body that is not JSON, and an empty body", () => {
    const message = "The body of the request must be JSON, and it is not valid JSON.";
    for (const text of ["", "{", "{'a':1}", "[1,]", "undefined", '{"a":1} x']) {
      expect(() => json(text), text).toThrow(new DataError(message));
    }
  });

  it("refuses a body whose bytes are not UTF-8", () => {
    expect(() => readJson(request({ body: new Uint8Array([0x22, 0xff, 0x22]) }))).toThrow(
      new DataError("The body of the request must be UTF-8 text, and it holds bytes that are not UTF-8."),
    );
  });

  it("accepts a body of exactly the most bytes and refuses one byte more", () => {
    const text = `"${"a".repeat(98)}"`;
    expect(json(text, { maxBytes: 100 })).toBe("a".repeat(98));
    expect(() => json(`${text} `, { maxBytes: 100 })).toThrow(
      new LimitError("The body of the request has 101 bytes, above the limit of 100 bytes.", "maxBytes", 100),
    );
  });

  it("limits the bytes of a body to 1,048,576 unless told otherwise", () => {
    const limit = 1_048_576;
    expect(json(`"${"a".repeat(limit - 2)}"`)).toHaveLength(limit - 2);
    expect(() => json(`"${"a".repeat(limit - 1)}"`)).toThrow(
      new LimitError(
        `The body of the request has ${limit + 1} bytes, above the limit of ${limit} bytes.`,
        "maxBytes",
        limit,
      ),
    );
  });

  it("counts bytes and not characters", () => {
    expect(() => json('"€€€"', { maxBytes: 10 })).toThrow("has 11 bytes");
    expect(json('"€€"', { maxBytes: 10 })).toBe("€€");
  });

  it("accepts arrays and objects nested to exactly the deepest level and refuses one level more", () => {
    expect(json(nested(3), { maxDepth: 3 })).toStrictEqual([[[]]]);
    expect(() => json(nested(4), { maxDepth: 3 })).toThrow(
      new LimitError("The JSON of the request nests deeper than the limit of 3 levels.", "maxDepth", 3),
    );
    expect(() => json('{"a":{"b":{"c":{}}}}', { maxDepth: 3 })).toThrow("nests deeper than the limit of 3 levels");
    expect(json('{"a":{"b":{}}}', { maxDepth: 3 })).toStrictEqual({ a: { b: {} } });
  });

  it("limits the depth to 64 levels unless told otherwise", () => {
    expect(json(nested(64))).toHaveLength(1);
    expect(() => json(nested(65))).toThrow(
      new LimitError("The JSON of the request nests deeper than the limit of 64 levels.", "maxDepth", 64),
    );
  });

  it("accepts a body of exactly the most tokens and refuses one token more", () => {
    expect(json("[1,2,3]", { maxTokens: 7 })).toStrictEqual([1, 2, 3]);
    expect(() => json("[1,2,3]", { maxTokens: 6 })).toThrow(
      new LimitError(
        "The JSON of the request has more than 6 tokens, above the limit of the option maxTokens.",
        "maxTokens",
        6,
      ),
    );
  });

  it("refuses a body that passes both limits for its depth, wherever the tokens pass theirs", () => {
    const deepLate = `[${"1,".repeat(20)}[[[[1]]]]]`;
    expect(() => json(deepLate, { maxDepth: 3, maxTokens: 10 })).toThrow("nests deeper than the limit of 3 levels");
    expect(() => json(`[[[[${"1,".repeat(20)}1]]]]`, { maxDepth: 3, maxTokens: 10 })).toThrow("nests deeper");
    expect(() => json(deepLate, { maxDepth: 5, maxTokens: 10 })).toThrow("has more than 10 tokens");
  });

  it("limits the tokens to 1,000,000 unless told otherwise, and refuses a body of empty arrays before parsing it", () => {
    const text = `[${"[],".repeat(400_000)}[]]`;
    expect(() => json(text, { maxBytes: 2_000_000 })).toThrow("has more than 1000000 tokens");
    expect(json(text, { maxBytes: 2_000_000, maxTokens: 1_200_004 })).toHaveLength(400_001);
  });

  it("refuses a body of a hundred thousand opening brackets without building anything", () => {
    expect(() => json("[".repeat(100_000), { maxBytes: 200_000 })).toThrow("nests deeper than the limit of 64 levels");
    expect(() => json('{"a":'.repeat(50_000), { maxBytes: 400_000 })).toThrow("nests deeper");
  });

  it("does not count brackets and braces inside strings, whatever the escapes before them", () => {
    expect(json('["[[[[", "{{{{", "\\"[[[[", "\\\\", "]]]]"]', { maxDepth: 1 })).toStrictEqual([
      "[[[[",
      "{{{{",
      '"[[[[',
      "\\",
      "]]]]",
    ]);
    // The quote after two backslashes ends the string, so the brackets that follow count.
    expect(() => json('["\\\\"], [[[[', { maxDepth: 2 })).toThrow("nests deeper");
  });

  it("reads any string as a value at depth 1, whatever brackets, quotes and backslashes it holds", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom("[", "]", "{", "}", '"', "\\", "a", "€") }), (text) => {
        expect(json(JSON.stringify([text]), { maxDepth: 1 })).toStrictEqual([text]);
        expect(json(JSON.stringify({ [text]: text }), { maxDepth: 1 })).toStrictEqual({ [text]: text });
      }),
      FUZZ,
    );
  });

  it("accepts nesting up to the limit and refuses deeper, for any depth and limit", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 80 }), fc.integer({ min: 1, max: 80 }), (depth, maxDepth) => {
        if (depth <= maxDepth) expect(json(nested(depth), { maxDepth })).toBeInstanceOf(Array);
        else expect(() => json(nested(depth), { maxDepth })).toThrow(DataError);
      }),
      FUZZ,
    );
  });

  it("returns what JSON.parse returns, for any JSON value within the limits", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = JSON.stringify(value);
        expect(json(text)).toStrictEqual(JSON.parse(text));
      }),
      FUZZ,
    );
  });

  it("makes __proto__ an own property and leaves the prototype alone", () => {
    const value = json('{"__proto__":{"admin":true}}') as Record<string, unknown>;
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it("refuses options of other types", () => {
    const body = request({ body: "{}" });
    const cases: readonly [string, ReadJsonOptions][] = [
      ["The options of readJson must be an object, found null.", JSON.parse("null")],
      ["The option maxBytes must be a positive integer, found 0.", { maxBytes: 0 }],
      ['The option maxBytes must be a positive integer, found "10".', JSON.parse('{"maxBytes":"10"}')],
      ["The option maxDepth must be a positive integer, found 1.5.", { maxDepth: 1.5 }],
      ["The option maxDepth must be a positive integer, found null.", JSON.parse('{"maxDepth":null}')],
      ["The option maxTokens must be a positive integer, found 0.", { maxTokens: 0 }],
    ];
    for (const [message, options] of cases) {
      expect(() => readJson(body, options), message).toThrow(new DataError(message));
    }
  });

  it("throws nothing but a DataError for any bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 80 }), (body) => expectOutcome(() => readJson(request({ body })))),
      FUZZ,
    );
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (text) => expectOutcome(() => json(text))),
      FUZZ,
    );
  });
});

describe("buildJsonResponse", () => {
  it("serializes the body and sets the media type", () => {
    expect(buildJsonResponse(200, { keys: [] })).toStrictEqual({
      status: 200,
      headers: { "content-type": "application/json;charset=UTF-8" },
      body: '{"keys":[]}',
    });
  });

  it("takes more headers, which win over the media type, and another media type", () => {
    expect(
      buildJsonResponse(
        403,
        { error: "x" },
        { headers: { "www-authenticate": "Bearer" }, type: "application/problem+json" },
      ),
    ).toStrictEqual({
      status: 403,
      headers: { "content-type": "application/problem+json", "www-authenticate": "Bearer" },
      body: '{"error":"x"}',
    });
    expect(buildJsonResponse(200, 1, { headers: { "content-type": "text/plain" } }).headers).toStrictEqual({
      "content-type": "text/plain",
    });
  });
});

describe("negotiate", () => {
  const offered = ["application/json", "text/plain"];

  it("chooses the first offered type when there is no Accept header, or it is empty", () => {
    expect(negotiate(undefined, offered)).toBe("application/json");
    expect(negotiate("", offered)).toBe("application/json");
    expect(negotiate("  ", offered)).toBe("application/json");
  });

  it("chooses the type that the header names", () => {
    expect(negotiate("text/plain", offered)).toBe("text/plain");
    expect(negotiate("text/html, text/plain", offered)).toBe("text/plain");
    expect(negotiate("application/json", offered)).toBe("application/json");
  });

  it("chooses by weight, and gives a tie to the first offered type", () => {
    expect(negotiate("application/json;q=0.5, text/plain;q=0.8", offered)).toBe("text/plain");
    expect(negotiate("application/json;q=0.8, text/plain;q=0.5", offered)).toBe("application/json");
    expect(negotiate("text/plain, application/json", offered)).toBe("application/json");
    expect(negotiate("text/plain, application/json", ["text/plain", "application/json"])).toBe("text/plain");
  });

  it("lets a more specific range decide the weight of a type, as RFC 9110 says", () => {
    const ranges = "text/*;q=0.3, text/plain;q=0.7, */*;q=0.5";
    expect(negotiate(ranges, ["text/html", "image/jpeg"])).toBe("image/jpeg");
    expect(negotiate(ranges, ["text/html", "image/jpeg", "text/plain"])).toBe("text/plain");
    expect(negotiate("*/*, text/plain;q=0", ["text/plain", "application/json"])).toBe("application/json");
    expect(negotiate("text/*;q=0, text/plain", ["text/html", "text/plain"])).toBe("text/plain");
  });

  it("follows the worked examples of the Accept header in RFC 9110", () => {
    const accept = "text/plain; q=0.5, text/html, text/x-dvi; q=0.8, text/x-c";
    expect(negotiate(accept, ["text/plain", "text/x-dvi", "text/x-c", "text/html"])).toBe("text/x-c");
    expect(negotiate(accept, ["text/plain", "text/x-dvi"])).toBe("text/x-dvi");
    expect(negotiate(accept, ["text/plain"])).toBe("text/plain");
    expect(negotiate("audio/*; q=0.2, audio/basic", ["audio/mpeg", "audio/basic"])).toBe("audio/basic");
    expect(negotiate("audio/*; q=0.2, audio/basic;q=0.1", ["audio/basic", "audio/mpeg"])).toBe("audio/mpeg");
  });

  it("matches wildcards, ignores case and spaces, and returns the type as it was offered", () => {
    expect(negotiate("*/*", ["Text/Plain"])).toBe("Text/Plain");
    expect(negotiate("TEXT/*;Q=0.9", ["application/json", "Text/Plain"])).toBe("Text/Plain");
    expect(negotiate("  text/plain  ;  q=0.9 ,  application/json  ;q=0.1", offered)).toBe("text/plain");
  });

  it("ignores parameters other than the weight, and the extensions after it", () => {
    expect(negotiate("text/plain;charset=utf-8;q=0.9, application/json;q=0.5", offered)).toBe("text/plain");
    expect(negotiate("text/plain;q=0.9;ext=1, application/json;q=0.95", offered)).toBe("application/json");
  });

  it("falls back to the first offered type when the header accepts none of them", () => {
    expect(negotiate("image/png", offered)).toBe("application/json");
    expect(negotiate("application/json;q=0, text/plain;q=0", offered)).toBe("application/json");
    expect(negotiate("text/plain;q=0", ["text/plain", "text/html"])).toBe("text/plain");
  });

  it("lets an entry that is not a media range, or has an invalid weight, accept nothing", () => {
    expect(negotiate("garbage, text/plain", offered)).toBe("text/plain");
    expect(negotiate("text, /plain, a/b/c, */json, text/plain", offered)).toBe("text/plain");
    expect(negotiate("text/plain;q=1.5, application/json;q=0.1", offered)).toBe("application/json");
    expect(negotiate("text/plain;q=abc, application/json;q=0.1", offered)).toBe("application/json");
    expect(negotiate("text/plain;q=0.1234, application/json;q=0.1", offered)).toBe("application/json");
    expect(negotiate("text/plain;q=, application/json;q=0.1", offered)).toBe("application/json");
  });

  it("refuses arguments of other types", () => {
    const cases: readonly [string, () => unknown][] = [
      ["The Accept header must be a string, found 5.", () => negotiate(JSON.parse("5"), offered)],
      ["The Accept header must be a string, found null.", () => negotiate(JSON.parse("null"), offered)],
      ["The offered media types must be an array, found null.", () => negotiate("*/*", JSON.parse("null"))],
      ["The offered media types must name at least one type, found none.", () => negotiate("*/*", [])],
      [
        'Each offered media type must be a type/subtype without parameters, found "text/plain;q=1".',
        () => negotiate("*/*", ["text/plain;q=1"]),
      ],
      [
        'Each offered media type must be a type/subtype without parameters, found "*/*".',
        () => negotiate("*/*", ["*/*"]),
      ],
      [
        "Each offered media type must be a type/subtype without parameters, found 5.",
        () => negotiate("*/*", JSON.parse("[5]")),
      ],
    ];
    for (const [message, call] of cases) expect(call, message).toThrow(new DataError(message));
  });

  it("returns one of the offered types for any header and any offered types", () => {
    const type = fc.stringMatching(/^[a-z]{1,6}\/[a-z]{1,6}$/u);
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.array(type, { minLength: 1, maxLength: 4 }), (accept, types) => {
        expect(types).toContain(negotiate(accept, types));
      }),
      FUZZ,
    );
  });

  it("chooses the first of the types with the highest weight, for any weights", () => {
    const weights = fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 5 });
    fc.assert(
      fc.property(weights, (values) => {
        const types = values.map((_value, index) => `text/t${index}`);
        const accept = values.map((value, index) => `text/t${index};q=${(value / 1000).toFixed(3)}`).join(", ");
        const best = Math.max(...values);
        const expected = best === 0 ? "text/t0" : `text/t${values.indexOf(best)}`;
        expect(negotiate(accept, types)).toBe(expected);
      }),
      FUZZ,
    );
  });
});

describe("readOffsetPage", () => {
  const sizes = { pageSize: 100, maxPageSize: 1000 };
  const query = (text: string) => readQuery(request({ url: `https://provider.example/list?${text}` }));

  it("reads the limit and the offset, and fills in the page size and the start", () => {
    expect(readOffsetPage(query("limit=10&offset=20"), sizes)).toStrictEqual({ limit: 10, offset: 20 });
    expect(readOffsetPage(query(""), sizes)).toStrictEqual({ limit: 100, offset: 0 });
    expect(readOffsetPage(query("offset=0"), sizes)).toStrictEqual({ limit: 100, offset: 0 });
  });

  it("lowers a limit and a page size above the largest page to it", () => {
    expect(readOffsetPage(query("limit=5000"), sizes)).toStrictEqual({ limit: 1000, offset: 0 });
    expect(readOffsetPage(query(""), { pageSize: 50, maxPageSize: 20 })).toStrictEqual({ limit: 20, offset: 0 });
  });

  it("refuses a limit below 1 and an offset below 0, as the PositiveInteger and NonNegativeInteger of the getCredentials request of Open Badges say", () => {
    const cases: readonly [string, string][] = [
      ["limit=0", 'The parameter limit must be a whole number of at least 1, found "0".'],
      ["offset=-1", 'The parameter offset must be a whole number of at least 0, found "-1".'],
      ["limit=1e3", 'The parameter limit must be a whole number of at least 1, found "1e3".'],
      ["limit=%205", 'The parameter limit must be a whole number of at least 1, found " 5".'],
      ["offset=1.5", 'The parameter offset must be a whole number of at least 0, found "1.5".'],
      [
        "limit=99999999999999999999",
        'The parameter limit must be a whole number of at least 1, found "99999999999999999999".',
      ],
    ];
    for (const [text, message] of cases)
      expect(() => readOffsetPage(query(text), sizes), text).toThrow(new DataError(message));
  });

  it("names the argument of another type, as JavaScript passes it", () => {
    expect(() => readOffsetPage(JSON.parse("{}"), sizes)).toThrow(
      new DataError("The parameters must be a Map of names to values, found an object."),
    );
    expect(() => readOffsetPage(new Map(), JSON.parse("null"))).toThrow(
      new DataError("The sizes of a page must be an object, found null."),
    );
    expect(() => readOffsetPage(new Map(), JSON.parse('{"pageSize":"100","maxPageSize":1000}'))).toThrow(DataError);
  });

  it("returns a page in range, or throws a DataError, for any limit and offset", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }), (limit, offset) => {
        let page: ReturnType<typeof readOffsetPage> | undefined;
        try {
          page = readOffsetPage(
            new Map([
              ["limit", limit],
              ["offset", offset],
            ]),
            sizes,
          );
        } catch (error) {
          expect(error).toBeInstanceOf(DataError);
          return;
        }
        expect(page.limit).toBeGreaterThanOrEqual(1);
        expect(page.limit).toBeLessThanOrEqual(1000);
        expect(page.offset).toBeGreaterThanOrEqual(0);
      }),
      FUZZ,
    );
  });
});

describe("buildPageLinks", () => {
  const url = "https://provider.example/ims/case/v1p1/CFDocuments?sort=title";
  const at = (offset: number) =>
    `https://provider.example/ims/case/v1p1/CFDocuments?sort=title&limit=10&offset=${offset}`;

  it("gives the first, previous, next and last pages of 503 items, as the example of the CASE binding pages them", () => {
    expect(buildPageLinks(url, { limit: 10, offset: 10 }, { total: 503 })).toBe(
      [`<${at(0)}>; rel="first"`, `<${at(0)}>; rel="prev"`, `<${at(20)}>; rel="next"`, `<${at(500)}>; rel="last"`].join(
        ", ",
      ),
    );
  });

  it("leaves out prev on the first page and next on the last, which the paging of Open Badges asks for only then", () => {
    expect(buildPageLinks(url, { limit: 10, offset: 0 }, { total: 10 })).toBe(
      `<${at(0)}>; rel="first", <${at(0)}>; rel="last"`,
    );
    expect(buildPageLinks(url, { limit: 10, offset: 0 }, { total: 0 })).toBe(
      `<${at(0)}>; rel="first", <${at(0)}>; rel="last"`,
    );
  });

  it("gives no last page when the total is unknown, and a next page when more may follow", () => {
    expect(buildPageLinks(url, { limit: 10, offset: 20 }, { more: true })).toBe(
      `<${at(0)}>; rel="first", <${at(10)}>; rel="prev", <${at(30)}>; rel="next"`,
    );
    expect(buildPageLinks(url, { limit: 10, offset: 20 }, { more: false })).toBe(
      `<${at(0)}>; rel="first", <${at(10)}>; rel="prev"`,
    );
  });

  it("replaces the limit and the offset of the request and keeps its other parameters", () => {
    const links = buildPageLinks(
      "https://p.example/c?since=2024-01-01T00%3A00%3A00Z&limit=3&offset=3",
      {
        limit: 3,
        offset: 3,
      },
      { total: 4 },
    );
    expect(links).toBe(
      [
        '<https://p.example/c?since=2024-01-01T00%3A00%3A00Z&limit=3&offset=0>; rel="first"',
        '<https://p.example/c?since=2024-01-01T00%3A00%3A00Z&limit=3&offset=0>; rel="prev"',
        '<https://p.example/c?since=2024-01-01T00%3A00%3A00Z&limit=3&offset=3>; rel="last"',
      ].join(", "),
    );
  });

  it("names the argument of another type", () => {
    expect(() => buildPageLinks("/c", { limit: 1, offset: 0 }, { total: 1 })).toThrow(
      new DataError('The URL must be an absolute URL, found "/c".'),
    );
    expect(() => buildPageLinks(url, JSON.parse('{"limit":0,"offset":0}'), { total: 1 })).toThrow(DataError);
    expect(() => buildPageLinks(url, { limit: 1, offset: 0 }, JSON.parse('{"total":"5"}'))).toThrow(DataError);
    expect(() => buildPageLinks(url, { limit: 1, offset: 0 }, JSON.parse("{}"))).toThrow(
      new DataError("The extent of the list must have a whole total or a boolean more, found an object."),
    );
  });
});

describe("buildStatusInfoResponse", () => {
  it("writes the imsx_StatusInfo of a failure with the detail of TargetEndSystem, as the REST bindings print it", () => {
    expect(
      buildStatusInfoResponse(429, "Busy.", { minor: "server_busy", headers: { "retry-after": "30" } }),
    ).toStrictEqual({
      status: 429,
      headers: { "content-type": "application/json;charset=UTF-8", "retry-after": "30" },
      body: JSON.stringify({
        imsx_codeMajor: "failure",
        imsx_severity: "error",
        imsx_description: "Busy.",
        imsx_codeMinor: {
          imsx_codeMinorField: [
            { imsx_codeMinorFieldName: "TargetEndSystem", imsx_codeMinorFieldValue: "server_busy" },
          ],
        },
      }),
    });
  });

  it("leaves out the detail when there is no code, and takes the severity status", () => {
    expect(JSON.parse(String(buildStatusInfoResponse(404, "Gone.", { severity: "status" }).body))).toStrictEqual({
      imsx_codeMajor: "failure",
      imsx_severity: "status",
      imsx_description: "Gone.",
    });
    expect(buildStatusInfoResponse(405, "No.").headers).toStrictEqual({
      "content-type": "application/json;charset=UTF-8",
    });
  });

  it("refuses a status that reports no failure, and options of another type", () => {
    expect(() => buildStatusInfoResponse(304, "Same.")).toThrow(
      new DataError("The status must be a whole number from 400 to 599, found 304."),
    );
    expect(() => buildStatusInfoResponse(JSON.parse('"500"'), "x")).toThrow(DataError);
    expect(() => buildStatusInfoResponse(500, "")).toThrow(DataError);
    expect(() => buildStatusInfoResponse(500, "x", JSON.parse('{"severity":"warning"}'))).toThrow(DataError);
    expect(() => buildStatusInfoResponse(500, "x", JSON.parse('{"headers":{"allow":5}}'))).toThrow(DataError);
    expect(() => buildStatusInfoResponse(500, "x", JSON.parse("null"))).toThrow(DataError);
  });
});

describe("readAccessDecision", () => {
  const grant = { grant: v.object({ owner: v.pipe(v.string(), v.nonEmpty()) }) };
  const read = (value: unknown) => readAccessDecision(value, "The decision", grant);

  it("reads an allowed decision with what it grants, and a refusal with its reason, message and delay", () => {
    expect(read({ allowed: true, owner: "learner-1", extra: 1 })).toStrictEqual({ allowed: true, owner: "learner-1" });
    expect(read({ allowed: false, reason: "too-many-requests", retryAfterSeconds: 30 })).toStrictEqual({
      allowed: false,
      reason: "too-many-requests",
      retryAfterSeconds: 30,
    });
    expect(readAccessDecision({ allowed: true, owner: "x" }, "The decision")).toStrictEqual({ allowed: true });
    const refusal = {
      allowed: false,
      reason: "unauthenticated",
      message: "The token expired.",
      challenge: 'Bearer error="invalid_token"',
    };
    expect(read(refusal)).toStrictEqual(refusal);
  });

  it("refuses another shape: a reason that is not one of the three, a delay that is not whole, an allowed one without its grant", () => {
    const bad = [
      { allowed: false, reason: "server-error" },
      { allowed: false, reason: "too-many-requests", retryAfterSeconds: 1.5 },
      { allowed: false, reason: "unauthenticated", message: 5 },
      { allowed: false, reason: "unauthenticated", challenge: ["Basic"] },
      { allowed: true },
      { allowed: true, owner: "" },
      { allowed: "yes", owner: "x" },
      JSON.parse("null"),
    ];
    for (const value of bad) {
      expect(() => read(value), JSON.stringify(value)).toThrow(
        expect.objectContaining({ name: "DataError", message: expect.stringContaining("The decision") }),
      );
    }
  });
});
