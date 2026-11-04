// biome-ignore-all lint/style/useNamingConvention: the names of the properties of imsx_StatusInfo are the specification's.

import { describe, expect, it, vi } from "vitest";
import {
  DataError,
  LimitError,
  readAnswer,
  readAnswerJson,
  readStatusDetail,
  readStatusInfo,
  ServiceError,
  type ServiceResponse,
} from "../src/index.js";

const WHAT = "The service at https://x.example/a";

/** An answer of a service whose body is the text, or the bytes, given. */
const answer = (body: string | Uint8Array<ArrayBuffer>): ServiceResponse => ({
  status: 200,
  headers: {},
  body: typeof body === "string" ? new TextEncoder().encode(body) : body,
});

/** Runs a reading and returns what it throws. */
function errorOf(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    return error;
  }
  throw new Error("The reading did not throw.");
}

/** Runs a reading and returns the message of what it throws. */
function messageOf(read: () => unknown): string {
  try {
    read();
  } catch (error) {
    if (error instanceof DataError) return error.message;
    throw error;
  }
  throw new Error("The reading did not throw.");
}

describe("the JSON of an answer", () => {
  it("is the value of a body of UTF-8 text that is JSON", () => {
    expect(readAnswerJson(answer('{"a":[1,"é",null]}'), WHAT)).toStrictEqual({ a: [1, "é", null] });
  });

  it("is refused for a body that is not UTF-8, not JSON, or empty, naming the service", () => {
    expect(messageOf(() => readAnswerJson(answer(Uint8Array.of(0x7b, 0xe9, 0x7d)), WHAT))).toBe(
      `${WHAT} answered with a body that is not UTF-8 text.`,
    );
    for (const body of ["<html>", "", "[1,"]) {
      expect(messageOf(() => readAnswerJson(answer(body), WHAT))).toBe(
        `${WHAT} answered with a body that is not JSON.`,
      );
    }
  });

  it("is refused before it is parsed when it nests deeper than 64 levels, or than maxDepth", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(messageOf(() => readAnswerJson(answer("[".repeat(100_000)), WHAT))).toBe(
        `${WHAT} answered with JSON that nests more than 64 levels.`,
      );
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
    const deep = `${"[".repeat(65)}${"]".repeat(65)}`;
    expect(readAnswerJson(answer(deep), WHAT, { maxDepth: 65 })).toHaveLength(1);
    expect(messageOf(() => readAnswerJson(answer("[[[]]]"), WHAT, { maxDepth: 2 }))).toContain(
      "nests more than 2 levels",
    );
  });

  it("is refused before it is parsed when it has more tokens than 1,000,000, or than maxTokens", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(messageOf(() => readAnswerJson(answer(`[${"[],".repeat(400_000)}[]]`), WHAT))).toBe(
        `${WHAT} answered with a body of more than 1000000 tokens of JSON, above the limit of the option maxTokens.`,
      );
      expect(messageOf(() => readAnswerJson(answer("[1,2,3,4,5,6,7,8,9,10,11,12,"), WHAT, { maxTokens: 10 }))).toBe(
        `${WHAT} answered with a body of more than 10 tokens of JSON, above the limit of the option maxTokens.`,
      );
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
    expect(readAnswerJson(answer("[1,2,3]"), WHAT, { maxTokens: 7 })).toStrictEqual([1, 2, 3]);
  });

  it("is refused for its depth when it passes both limits, whichever it passes first", () => {
    // The fifth token passes a limit of four tokens before the brackets pass the depth of three.
    expect(messageOf(() => readAnswerJson(answer("[1,2,[[[[]]]]]"), WHAT, { maxDepth: 3, maxTokens: 4 }))).toContain(
      "nests more than 3 levels",
    );
    expect(messageOf(() => readAnswerJson(answer("[[[[1,2,3]]]]"), WHAT, { maxDepth: 3, maxTokens: 4 }))).toContain(
      "nests more than 3 levels",
    );
  });

  it("is refused over a limit with a LimitError that names the limit and its value", () => {
    expect(errorOf(() => readAnswerJson(answer("[[[]]]"), WHAT, { maxDepth: 2 }))).toMatchObject({
      name: "LimitError",
      limit: "maxDepth",
      maximum: 2,
    });
    expect(errorOf(() => readAnswerJson(answer("[1,2,3]"), WHAT, { maxTokens: 6 }))).toMatchObject({
      name: "LimitError",
      limit: "maxTokens",
      maximum: 6,
    });
  });

  it("keeps the error of the decoder and of the parser as the cause", () => {
    expect(errorOf(() => readAnswerJson(answer(Uint8Array.of(0x7b, 0xe9, 0x7d)), WHAT))).toMatchObject({
      cause: { name: "TypeError" },
    });
    expect(errorOf(() => readAnswerJson(answer("[1,"), WHAT))).toMatchObject({ cause: { name: "SyntaxError" } });
  });

  it("is refused options of the wrong type", () => {
    for (const options of [null, "x", { maxDepth: 0 }, { maxTokens: 1.5 }, { maxDepth: "64" }]) {
      expect(() => readAnswerJson(answer("[]"), WHAT, JSON.parse(JSON.stringify(options)))).toThrow(DataError);
    }
  });
});

describe("the reading of the data of an answer", () => {
  it("names the service and the standard, and keeps the reason of whatever a reader throws", () => {
    expect(() =>
      readAnswer("The CLR API at a", "CLR", () => {
        throw new DataError("bad");
      }),
    ).toThrow(new DataError("The CLR API at a answered with data that is not valid CLR: bad"));
    expect(() =>
      readAnswer("The CLR API at a", "CLR", () => {
        throw "plain text";
      }),
    ).toThrow(new DataError("The CLR API at a answered with data that is not valid CLR: plain text"));
    expect(() =>
      readAnswer("The CASE provider at b", "CASE", () => {
        throw new TypeError("no such property");
      }),
    ).toThrow(new DataError("The CASE provider at b answered with data that is not valid CASE: no such property"));
  });

  it("keeps a LimitError that the reader threw as a LimitError, with its limit, its value and the cause", () => {
    const over = new LimitError("The text has more than 9 tokens.", "maxTokens", 9);
    const error = errorOf(() =>
      readAnswer(WHAT, "xAPI", () => {
        throw over;
      }),
    );
    expect(error).toStrictEqual(
      new LimitError(`${WHAT} answered with data over a limit: The text has more than 9 tokens.`, "maxTokens", 9),
    );
    expect((error as LimitError).cause).toBe(over);
  });

  it("keeps what the reader threw as the cause", () => {
    const thrown = new TypeError("no such property");
    let error: unknown;
    try {
      readAnswer(WHAT, "CASE", () => {
        throw thrown;
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).cause).toBe(thrown);
  });

  it("gives what the reader returns", () => {
    expect(readAnswer(WHAT, "CASE", () => 5)).toBe(5);
  });
});

describe("the status of a refusal", () => {
  const status = { imsx_codeMajor: "failure", imsx_severity: "error" };
  const asStatus = (json: unknown) => {
    if (typeof json !== "object" || json === null || !("imsx_codeMajor" in json)) throw new DataError("not a status");
    return json;
  };

  it("reads the status in the body with the reader that it is given, and the seconds of Retry-After", () => {
    const error = new ServiceError("refused", 429, JSON.stringify(status), { headers: { "retry-after": "120" } });
    expect(readStatusDetail(error, asStatus)).toStrictEqual({ info: status, retryAfterSeconds: 120 });
  });

  it("leaves out a body that is not JSON or that the reader refuses, and a Retry-After that gives a date", () => {
    const html = new ServiceError("refused", 502, "<html>Bad gateway</html>", {
      headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
    });
    expect(readStatusDetail(html, asStatus)).toStrictEqual({});
    expect(readStatusDetail(new ServiceError("refused", 400, "{}"), asStatus)).toStrictEqual({});
  });

  it("does not parse a body that has more tokens than a status can have", () => {
    const body = `[${"[],".repeat(400_000)}[]]`;
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(readStatusDetail(new ServiceError("refused", 400, body), asStatus)).toStrictEqual({});
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("refuses what is not a ServiceError", () => {
    for (const error of [null, new Error("x"), "x", {}]) {
      expect(() => readStatusDetail(error as never, asStatus)).toThrow(DataError);
    }
  });
});

describe("readStatusInfo", () => {
  const busy = {
    imsx_codeMajor: "failure",
    imsx_severity: "error",
    imsx_description: "Slow down.",
    imsx_codeMinor: {
      imsx_codeMinorField: [{ imsx_codeMinorFieldName: "TargetEndSystem", imsx_codeMinorFieldValue: "server_busy" }],
    },
  };
  const refused = (body: string, headers: Record<string, string> = {}) =>
    new ServiceError("The provider answered.", 429, body, { headers });

  it("reads the imsx_StatusInfo of the body and the seconds that Retry-After asks for", () => {
    expect(readStatusInfo(refused(JSON.stringify(busy), { "retry-after": " 30 " }))).toStrictEqual({
      info: busy,
      retryAfterSeconds: 30,
    });
  });

  it("reads the code of a detail as text, whatever the vocabulary of the service", () => {
    const other = {
      ...busy,
      imsx_codeMinor: {
        imsx_codeMinorField: [{ imsx_codeMinorFieldName: "TargetEndSystem", imsx_codeMinorFieldValue: "invalid_data" }],
      },
    };
    expect(readStatusInfo(refused(JSON.stringify(other))).info?.imsx_codeMinor?.imsx_codeMinorField[0]).toStrictEqual(
      other.imsx_codeMinor.imsx_codeMinorField[0],
    );
  });

  it("gives the delay alone when the body is not a status", () => {
    const wrong = [
      "<html>busy</html>",
      "",
      "{}",
      '{"imsx_codeMajor":"failure"}',
      JSON.stringify({ ...busy, imsx_codeMajor: "broken" }),
      JSON.stringify({ ...busy, imsx_severity: 1 }),
      JSON.stringify({ ...busy, extra: true }),
      JSON.stringify({ ...busy, imsx_codeMinor: { imsx_codeMinorField: [] } }),
      JSON.stringify({ ...busy, imsx_codeMinor: { imsx_codeMinorField: [{ imsx_codeMinorFieldName: "x" }] } }),
    ];
    for (const body of wrong) {
      expect(readStatusInfo(refused(body, { "retry-after": "7" })), body).toStrictEqual({ retryAfterSeconds: 7 });
    }
  });

  it("gives nothing for a Retry-After that is a date, a negative number or text", () => {
    for (const value of ["Wed, 21 Oct 2026 07:28:00 GMT", "-5", "1e3", "soon", "", "9999999999999999"]) {
      expect(readStatusInfo(refused("{}", { "retry-after": value }))).toStrictEqual({});
    }
  });

  it("refuses what is not a ServiceError", () => {
    for (const error of [null, new Error("x"), "x", {}]) {
      expect(() => readStatusInfo(error as never)).toThrow(DataError);
    }
  });
});
