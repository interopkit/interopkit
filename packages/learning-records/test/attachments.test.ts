import { DataError } from "@interopkit/core";
import { describe, expect, it, vi } from "vitest";
import { attachmentHash, MultipartLimitError, readMultipart, writeMultipart } from "../src/attachments/index.js";
import type { Statement } from "../src/index.js";
import { minimalStatement, subStatementStatement } from "./full-statement.js";
import { dataOf, messageOf, sha2Of, statementWithAttachments } from "./multipart.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The Content-Type header that goes with a message written by `messageOf`. */
const BOUNDARY = "abcABC0123'()+_,-./:=?";
const CONTENT_TYPE = `multipart/mixed; boundary="${BOUNDARY}"`;
const STATEMENTS = JSON.stringify([minimalStatement()]);

/** A part after the first, with the headers that the standard asks of it. */
function part(text: string, extra: string[] = [], hash = sha2Of(text)) {
  return {
    headers: [
      "Content-Type: text/plain",
      "Content-Transfer-Encoding: binary",
      `X-Experience-API-Hash: ${hash}`,
      ...extra,
    ],
    body: text,
  };
}

describe("attachmentHash", () => {
  it("returns the SHA-256 of the data as 64 hexadecimal digits in lower case", () => {
    // The worked examples of FIPS 180-4: the hash of "abc" and of the empty message.
    expect(attachmentHash(encoder.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(attachmentHash(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("refuses what is not bytes", () => {
    for (const value of [JSON.parse('"abc"'), JSON.parse("[1,2]"), JSON.parse("null"), JSON.parse("{}")]) {
      expect(() => attachmentHash(value)).toThrow(DataError);
      expect(() => attachmentHash(value)).toThrow(/^The body must be a Uint8Array, found /);
    }
  });
});

describe("readMultipart", () => {
  it("reads the Statements of the first part and the data of the other parts by their hash", () => {
    const text = "some text";
    const message = messageOf(BOUNDARY, STATEMENTS, [part(text)]);
    const { statements, parts } = readMultipart(CONTENT_TYPE, message);
    expect(statements).toStrictEqual([minimalStatement()]);
    expect([...parts.keys()]).toStrictEqual([sha2Of(text)]);
    const data = parts.get(sha2Of(text));
    expect(data?.contentType).toBe("text/plain");
    expect(decoder.decode(data?.body)).toBe(text);
  });

  it("reads a message that has no Attachment, and one with a single part and an empty body", () => {
    expect(readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, [])).parts.size).toBe(0);
    const empty = readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, [part("")]));
    expect(empty.parts.get(sha2Of(""))?.body.byteLength).toBe(0);
  });

  it("keeps the bytes of a part exactly, binary and line ends included", () => {
    const bytes = Uint8Array.from([0, 255, 13, 10, 45, 45, 13, 10, 128, 0]);
    const hash = sha2Of(bytes);
    const message = new Uint8Array([
      ...encoder.encode(
        `--${BOUNDARY}\r\nContent-Type: application/json\r\n\r\n${STATEMENTS}\r\n--${BOUNDARY}\r\nContent-Type: application/octet-stream\r\nX-Experience-API-Hash: ${hash}\r\n\r\n`,
      ),
      ...bytes,
      ...encoder.encode(`\r\n--${BOUNDARY}--\r\n`),
    ]);
    expect(readMultipart(CONTENT_TYPE, message).parts.get(hash)?.body).toStrictEqual(bytes);
  });

  it("reads the hash of 224, 384 and 512 bits, in either case, and names the data by the hash in lower case", () => {
    const text = "hash lengths";
    for (const algorithm of ["sha224", "sha384", "sha512"] as const) {
      for (const hash of [sha2Of(text, algorithm), sha2Of(text, algorithm).toUpperCase()]) {
        const { parts } = readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, [part(text, [], hash)]));
        expect([...parts.keys()]).toStrictEqual([sha2Of(text, algorithm)]);
      }
    }
  });

  it("reads a part with no Content-Type as application/octet-stream, and one with no Content-Transfer-Encoding as binary", () => {
    const text = "bare";
    const bare = { headers: [`X-Experience-API-Hash: ${sha2Of(text)}`], body: text };
    expect(
      readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, [bare])).parts.get(sha2Of(text))?.contentType,
    ).toBe("application/octet-stream");
  });

  it("reads a Content-Length that matches, and any case of the names of the headers", () => {
    const text = "lengths";
    const shouting = {
      headers: [
        "CONTENT-TYPE: text/plain",
        "content-transfer-encoding: BINARY",
        `x-experience-api-hash: ${sha2Of(text)}`,
        `Content-Length: ${text.length}`,
      ],
      body: text,
    };
    expect(readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, [shouting])).parts.size).toBe(1);
  });

  it("keeps the first of two parts that have one hash", () => {
    const text = "twice";
    const twice = [
      part(text),
      { ...part(text), headers: part(text).headers.map((line) => line.replace("text/plain", "text/html")) },
    ];
    const { parts } = readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, twice));
    expect(parts.size).toBe(1);
    expect(parts.get(sha2Of(text))?.contentType).toBe("text/plain");
  });

  it("reads the first part when it names application/json with a charset, in any case", () => {
    const message = encoder.encode(`--b\r\nContent-Type: Application/JSON; charset=utf-8\r\n\r\n{}\r\n--b--\r\n`);
    expect(readMultipart("multipart/mixed; boundary=b", message).statements).toStrictEqual({});
    const unnamed = encoder.encode(`--b\r\nX-Other: 1\r\n\r\n{}\r\n--b--\r\n`);
    expect(readMultipart("MULTIPART/Mixed; boundary=b", unnamed).statements).toStrictEqual({});
  });

  it("refuses a property given twice in the first part", () => {
    const message = messageOf(BOUNDARY, '{"a":1,"a":2}', []);
    expect(() => readMultipart(CONTENT_TYPE, message)).toThrow('The text has the property "a" twice');
  });

  describe("a message that is not valid", () => {
    const ok = messageOf(BOUNDARY, STATEMENTS, [part("x")]);

    it.each([
      ["text/plain", 'The content type must be multipart/mixed, found "text/plain".'],
      [
        "multipart/form-data; boundary=b",
        'The content type must be multipart/mixed, found "multipart/form-data; boundary=b".',
      ],
      ["", 'The content type must be multipart/mixed, found "".'],
      ["multipart/mixed", 'The content type "multipart/mixed" has no boundary parameter.'],
      ["multipart/mixed; boundary=", 'The content type "multipart/mixed; boundary=" has no boundary parameter.'],
      [
        `multipart/mixed; boundary=${"b".repeat(71)}`,
        "The multipart message is not valid: Multipart boundary exceeds maximum length of 70 characters.",
      ],
    ])("refuses the content type %j", (contentType, sentence) => {
      expect(() => readMultipart(contentType, ok)).toThrow(new DataError(sentence));
    });

    it("refuses a message with no part, and one that is cut off", () => {
      expect(() => readMultipart(CONTENT_TYPE, new Uint8Array())).toThrow(
        "The multipart message has no part, and its first part must hold the Statements.",
      );
      expect(() => readMultipart(CONTENT_TYPE, encoder.encode(`--${BOUNDARY}--\r\n`))).toThrow(
        "The multipart message has no part",
      );
      expect(() => readMultipart(CONTENT_TYPE, ok.slice(0, ok.length - 20))).toThrow(
        /^The multipart message is not valid: /,
      );
      expect(() => readMultipart(CONTENT_TYPE, encoder.encode("not a multipart message"))).toThrow(DataError);
    });

    it("refuses a first part that is not JSON, not UTF-8 or not application/json", () => {
      expect(() => readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, "not json", []))).toThrow(
        "The text is not valid JSON",
      );
      const notUtf8 = new Uint8Array([
        ...encoder.encode(`--${BOUNDARY}\r\nContent-Type: application/json\r\n\r\n`),
        0xff,
        0xfe,
        ...encoder.encode(`\r\n--${BOUNDARY}--\r\n`),
      ]);
      expect(() => readMultipart(CONTENT_TYPE, notUtf8)).toThrow(
        "The first part is not valid UTF-8 text, which JSON must be.",
      );
      const xml = encoder.encode(`--${BOUNDARY}\r\nContent-Type: application/xml\r\n\r\n<a/>\r\n--${BOUNDARY}--\r\n`);
      expect(() => readMultipart(CONTENT_TYPE, xml)).toThrow(
        'The first part must be application/json, found "application/xml".',
      );
    });

    it.each([
      [
        { headers: ["Content-Type: text/plain"], body: "x" },
        "A part after the first has no X-Experience-API-Hash header",
      ],
      [
        part("x", [], "not a hash"),
        'The X-Experience-API-Hash of a part must be a SHA-2 hash in hexadecimal digits, found "not a hash".',
      ],
      [part("x", [], sha2Of("x").slice(1)), "must be a SHA-2 hash in hexadecimal digits"],
      [
        part("x", [], sha2Of("another")),
        `The part with the hash ${sha2Of("another")} holds data that have another hash.`,
      ],
      [part("x", [], sha2Of("x", "sha512").replace(/.$/u, "0")), "holds data that have another hash."],
      [
        { headers: ["Content-Transfer-Encoding: base64", `X-Experience-API-Hash: ${sha2Of("x")}`], body: "x" },
        'The Content-Transfer-Encoding of a part must be binary, found "base64".',
      ],
      [
        { headers: ["Content-Type: not a type", `X-Experience-API-Hash: ${sha2Of("x")}`], body: "x" },
        'The Content-Type of a part must be an Internet media type, found "not a type".',
      ],
      [part("x", ["Content-Length: 5"]), `The part with the hash ${sha2Of("x")} declares "5" bytes and holds 1.`],
      [part("x", ["Content-Length: x"]), 'declares "x" bytes and holds 1.'],
    ])("refuses the part %j", (badPart, sentence) => {
      expect(() => readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, [badPart]))).toThrow(DataError);
      expect(() => readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, [badPart]))).toThrow(sentence);
    });

    it("refuses a header that is not UTF-8, in the first part and in another", () => {
      const header = (bytes: number[]) => Uint8Array.from([...encoder.encode("X-Other: "), ...bytes]);
      const part = (headers: Uint8Array[], body: string) =>
        Uint8Array.from([...headers.flatMap((line) => [...line, 13, 10]), 13, 10, ...encoder.encode(body)]);
      const joinParts = (...parts: Uint8Array[]) =>
        Uint8Array.from(
          parts
            .flatMap((bytes) => [...encoder.encode(`--${BOUNDARY}\r\n`), ...bytes, 13, 10])
            .concat([...encoder.encode(`--${BOUNDARY}--\r\n`)]),
        );
      const first = part([header([0xff])], "{}");
      const second = part([header([0xff])], "x");
      expect(() => readMultipart(CONTENT_TYPE, joinParts(first))).toThrow(
        "A part has a header that is not valid UTF-8 text.",
      );
      expect(() => readMultipart(CONTENT_TYPE, joinParts(part([], "{}"), second))).toThrow(
        "A part has a header that is not valid UTF-8 text.",
      );
    });

    it("refuses a hash given twice in the headers of one part", () => {
      const doubled = part("x", [`X-Experience-API-Hash: ${sha2Of("x")}`]);
      expect(() => readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, [doubled]))).toThrow(
        "must be a SHA-2 hash in hexadecimal digits",
      );
    });

    it("refuses arguments of other types, as JavaScript or JSON pass them", () => {
      for (const value of [JSON.parse("null"), JSON.parse("5"), JSON.parse("[]")]) {
        expect(() => readMultipart(value, ok)).toThrow(/^The content type must be a string, found /);
        expect(() => readMultipart(CONTENT_TYPE, value)).toThrow(/^The body must be a Uint8Array, found /);
      }
      expect(() => readMultipart(CONTENT_TYPE, JSON.parse('"text"'))).toThrow(DataError);
    });

    it.each([
      [null, "The options object is invalid: expected an object, found null."],
      [[], "The options object is invalid: expected an object, found an array."],
      [{ maxParts: 0 }, "The options object is invalid at maxParts: expected a value of at least 1, found 0."],
      [{ maxPartBytes: "10" }, 'The options object is invalid at maxPartBytes: expected a number, found "10".'],
      [{ maxTotalBytes: 1.5 }, "The options object is invalid at maxTotalBytes: expected a safe integer, found 1.5."],
      [{ maxDepth: 0 }, "The options object is invalid at maxDepth: expected a value of at least 1, found 0."],
      [{ limit: 1 }, 'The options object is invalid: unexpected property "limit".'],
    ])("refuses the limits %j", (limits, sentence) => {
      expect(() => readMultipart(CONTENT_TYPE, ok, JSON.parse(JSON.stringify(limits)))).toThrow(
        new DataError(sentence),
      );
    });
  });

  describe("the limits", () => {
    /** A message with as many parts as it says after the Statements, each with different data. */
    const manyParts = (count: number) =>
      messageOf(
        BOUNDARY,
        STATEMENTS,
        Array.from({ length: count }, (_, index) => part(`part ${index}`)),
      );

    it("reads 100 parts, the Statements included, and refuses 101", () => {
      expect(readMultipart(CONTENT_TYPE, manyParts(99)).parts.size).toBe(99);
      expect(() => readMultipart(CONTENT_TYPE, manyParts(100))).toThrow(
        "The multipart message is not valid: Multipart part count exceeds maximum allowed count of 100.",
      );
    });

    it("refuses more parts than maxParts, whatever the default", () => {
      expect(readMultipart(CONTENT_TYPE, manyParts(2), { maxParts: 3 }).parts.size).toBe(2);
      expect(() => readMultipart(CONTENT_TYPE, manyParts(3), { maxParts: 3 })).toThrow("part count exceeds");
      expect(readMultipart(CONTENT_TYPE, manyParts(150), { maxParts: 200 }).parts.size).toBe(150);
    });

    it("refuses a part above maxPartBytes, the first part included", () => {
      const message = messageOf(BOUNDARY, STATEMENTS, [part("x".repeat(300))]);
      expect(readMultipart(CONTENT_TYPE, message, { maxPartBytes: 300 }).parts.size).toBe(1);
      expect(() => readMultipart(CONTENT_TYPE, message, { maxPartBytes: 299 })).toThrow(
        "The multipart message is not valid: File size exceeds maximum allowed size of 299 bytes.",
      );
      expect(() => readMultipart(CONTENT_TYPE, message, { maxPartBytes: STATEMENTS.length - 1 })).toThrow(
        "exceeds maximum",
      );
    });

    it("refuses all parts together above maxTotalBytes", () => {
      const message = messageOf(BOUNDARY, STATEMENTS, [part("a".repeat(60)), part("b".repeat(60))]);
      const total = STATEMENTS.length + 120;
      expect(readMultipart(CONTENT_TYPE, message, { maxTotalBytes: total }).parts.size).toBe(2);
      expect(() => readMultipart(CONTENT_TYPE, message, { maxTotalBytes: total - 1 })).toThrow(
        `Multipart content size exceeds maximum allowed size of ${total - 1} bytes.`,
      );
    });

    it("refuses a message over a limit with a MultipartLimitError that names the limit, and a malformed one with a DataError", () => {
      const limitOf = (run: () => unknown): unknown => {
        try {
          run();
        } catch (error) {
          return error instanceof MultipartLimitError ? error.limit : error;
        }
        return undefined;
      };
      const message = messageOf(BOUNDARY, STATEMENTS, [part("a".repeat(60)), part("b".repeat(60))]);
      expect(limitOf(() => readMultipart(CONTENT_TYPE, message, { maxParts: 2 }))).toBe("parts");
      expect(limitOf(() => readMultipart(CONTENT_TYPE, message, { maxPartBytes: 200 }))).toBeUndefined();
      expect(limitOf(() => readMultipart(CONTENT_TYPE, message, { maxPartBytes: 59 }))).toBe("part-bytes");
      expect(limitOf(() => readMultipart(CONTENT_TYPE, message, { maxTotalBytes: 200 }))).toBe("total-bytes");
      const wide = messageOf(BOUNDARY, STATEMENTS, [
        { headers: [`X-Experience-API-Hash: ${"a".repeat(9000)}`], body: "x" },
      ]);
      expect(limitOf(() => readMultipart(CONTENT_TYPE, wide))).toBe("header-bytes");
      const broken = limitOf(() => readMultipart(CONTENT_TYPE, message.slice(0, 30)));
      expect(broken).toBeInstanceOf(DataError);
      expect(broken).not.toBeInstanceOf(MultipartLimitError);
      expect(new MultipartLimitError("x", "parts")).toBeInstanceOf(DataError);
    });

    it("refuses JSON nested deeper than maxDepth in the first part, 64 levels by default", () => {
      const nested = (levels: number) => `${"[".repeat(levels)}${"]".repeat(levels)}`;
      expect(readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, nested(64), [])).statements).toBeInstanceOf(Array);
      expect(() => readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, nested(65), []))).toThrow(
        "deeper than the limit of 64",
      );
      expect(
        readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, nested(5), []), { maxDepth: 5 }).statements,
      ).toBeInstanceOf(Array);
      expect(() => readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, nested(5), []), { maxDepth: 4 })).toThrow(
        "deeper than the limit of 4",
      );
    });

    it("refuses 10 MiB and one more byte in a part by default", () => {
      const big = part("x".repeat(10_485_761));
      expect(() => readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, [big]))).toThrow(
        "File size exceeds maximum allowed size of 10485760 bytes.",
      );
    });

    it("limits the first part by maxPartBytes with the limit of readStatementJson", () => {
      const statements = `[${"0,".repeat(600_000)}0]`;
      expect(() => readMultipart(CONTENT_TYPE, messageOf(BOUNDARY, statements, []))).toThrow(
        "The text has more than 1000000 tokens",
      );
    });
  });

  it("does not hide an error of the parser that is not about the message", async () => {
    vi.resetModules();
    vi.doMock("@remix-run/multipart-parser", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@remix-run/multipart-parser")>()),
      parseMultipart: () => {
        throw new TypeError("a defect of the parser");
      },
    }));
    try {
      const { readMultipart: withBrokenParser } = await import("../src/attachments/index.js");
      expect(() => withBrokenParser(CONTENT_TYPE, messageOf(BOUNDARY, STATEMENTS, []))).toThrow(
        new TypeError("a defect of the parser"),
      );
    } finally {
      vi.doUnmock("@remix-run/multipart-parser");
      vi.resetModules();
    }
  });
});

describe("writeMultipart", () => {
  it("writes the Statements and each part with the headers that the standard asks for", () => {
    const text = dataOf("some text");
    const { contentType, body } = writeMultipart([statementWithAttachments([text])], [text]);
    expect(contentType).toMatch(/^multipart\/mixed; boundary=interopkit-[0-9a-f]{32}$/u);
    const boundary = contentType.split("boundary=")[1];
    const json = JSON.stringify([statementWithAttachments([text])]);
    expect(decoder.decode(body)).toBe(
      [
        `--${boundary}`,
        "Content-Type: application/json",
        "",
        json,
        `--${boundary}`,
        "Content-Type: text/plain",
        "Content-Transfer-Encoding: binary",
        `X-Experience-API-Hash: ${text.sha2}`,
        "",
        "some text",
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    );
  });

  it("writes one Statement as an object, an array as an array, and a result with its more", () => {
    const statement = minimalStatement();
    const first = (statements: Parameters<typeof writeMultipart>[0]) =>
      readMultipart(...(Object.values(writeMultipart(statements, [])) as [string, Uint8Array])).statements;
    expect(first(statement)).toStrictEqual(statement);
    expect(first([statement, statement])).toStrictEqual([statement, statement]);
    expect(first({ statements: [statement], more: "/xapi/statements?from=1" })).toStrictEqual({
      statements: [statement],
      more: "/xapi/statements?from=1",
    });
    expect(first({ statements: [] })).toStrictEqual({ statements: [] });
  });

  it("writes a message that readMultipart reads back, bytes and types exactly", () => {
    const binary = {
      sha2: "",
      contentType: "image/png",
      body: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]),
    };
    const png = { ...binary, sha2: sha2Of(binary.body) };
    const text = dataOf("a\r\n--not a boundary\r\n", "text/plain; charset=utf-8");
    const written = writeMultipart([statementWithAttachments([png, text])], [png, text]);
    const { statements, parts } = readMultipart(written.contentType, written.body);
    expect(statements).toStrictEqual([statementWithAttachments([png, text])]);
    expect(parts.get(png.sha2)).toStrictEqual(png);
    expect(parts.get(text.sha2)).toStrictEqual(text);
  });

  it("writes the same message for the same input, and another boundary for other data", () => {
    const one = dataOf("one");
    const two = dataOf("two");
    const first = writeMultipart([statementWithAttachments([one])], [one]);
    expect(writeMultipart([statementWithAttachments([one])], [one])).toStrictEqual(first);
    expect(writeMultipart([statementWithAttachments([two])], [two]).contentType).not.toBe(first.contentType);
  });

  it("names a part by the hash in lower case, whatever the case of the header", () => {
    const data = dataOf("upper");
    const shouting = { ...data, sha2: data.sha2.toUpperCase() };
    const written = writeMultipart([statementWithAttachments([shouting])], [shouting]);
    expect(decoder.decode(written.body)).toContain(`X-Experience-API-Hash: ${data.sha2}\r\n`);
    expect(readMultipart(written.contentType, written.body).parts.has(data.sha2)).toBe(true);
  });

  it("sends the data of an Attachment that also has a fileUrl, and none for the one that has only a fileUrl", () => {
    const sent = dataOf("sent");
    const linked = dataOf("linked");
    const statement = statementWithAttachments([sent, linked], [sent.sha2, linked.sha2]);
    expect(
      readMultipart(...(Object.values(writeMultipart([statement], [sent])) as [string, Uint8Array])).parts.size,
    ).toBe(1);
    expect(readMultipart(...(Object.values(writeMultipart([statement], [])) as [string, Uint8Array])).parts.size).toBe(
      0,
    );
  });

  it("sends one copy of the data that several Statements use, and the data of a SubStatement's Attachment", () => {
    const shared = dataOf("shared");
    const inner = dataOf("inner");
    const subStatement = subStatementStatement();
    const withInner = {
      ...subStatement,
      object: { ...subStatement.object, attachments: statementWithAttachments([inner]).attachments },
    } as typeof subStatement;
    const written = writeMultipart(
      [statementWithAttachments([shared]), statementWithAttachments([shared]), withInner],
      [shared, inner],
    );
    expect(readMultipart(written.contentType, written.body).parts.size).toBe(2);
  });

  it("writes a message for a SubStatement that has no attachments", () => {
    const { attachments: _attachments, ...inner } = subStatementStatement().object as { attachments?: unknown };
    const statement = { ...subStatementStatement(), object: inner } as Statement;
    expect(readMultipart(...(Object.values(writeMultipart([statement], [])) as [string, Uint8Array])).parts.size).toBe(
      0,
    );
  });

  describe("input that an LRS would refuse", () => {
    const text = dataOf("some text");

    it("refuses a Statement that is not valid, as an LRS reads it", () => {
      expect(() => writeMultipart([{ actor: {} } as never], [])).toThrow(DataError);
      expect(() => writeMultipart({ actor: {} } as never, [])).toThrow("The statement is invalid");
      expect(() => writeMultipart({ statements: [{}] } as never, [])).toThrow("The statement is invalid");
    });

    it("refuses a result that has another property, or a more that is not text", () => {
      expect(() => writeMultipart({ statements: [], extra: 1 } as never, [])).toThrow(
        'The result has the properties "statements" and "more", found "extra".',
      );
      expect(() => writeMultipart({ statements: [], more: 5 } as never, [])).toThrow(
        "The property more of the result must be a string, found 5.",
      );
      expect(() => writeMultipart({ statements: "x" } as never, [])).toThrow(
        'The property statements of the result must be an array, found "x".',
      );
    });

    it("refuses a part that is not valid", () => {
      const statements = [statementWithAttachments([text])];
      expect(() => writeMultipart(statements, JSON.parse('"x"'))).toThrow("The parts must be an array");
      expect(() => writeMultipart(statements, JSON.parse("[1]"))).toThrow(/^The part 0 is invalid: /);
      expect(() => writeMultipart(statements, [{ ...text, sha2: "nope" }])).toThrow(
        "The part 0 is invalid at sha2: expected a SHA-2 hash as 56, 64, 96 or 128 hexadecimal digits",
      );
      expect(() => writeMultipart(statements, [{ ...text, contentType: "text/plain\r\nX-Injected: 1" }])).toThrow(
        "The part 0 is invalid at contentType: expected an Internet media type",
      );
      expect(() => writeMultipart(statements, [{ ...text, body: "text" as never }])).toThrow(
        "The part 0 is invalid at body: expected a Uint8Array",
      );
      expect(() => writeMultipart(statements, [{ ...text, extra: 1 } as never])).toThrow('unexpected property "extra"');
    });

    it("refuses a part that does not hold the data of its hash", () => {
      const statements = [statementWithAttachments([text])];
      const other = encoder.encode("other");
      expect(() => writeMultipart(statements, [{ ...text, body: other }])).toThrow(
        `The part with the hash ${text.sha2} holds data that have another hash.`,
      );
    });

    it("refuses two parts with one hash", () => {
      const statements = [statementWithAttachments([text])];
      expect(() => writeMultipart(statements, [text, { ...text, sha2: text.sha2.toUpperCase() }])).toThrow(
        `Two parts have the hash ${text.sha2.toUpperCase()}: the data of an Attachment travel once.`,
      );
    });

    it("refuses a part that no Attachment names", () => {
      expect(() => writeMultipart([minimalStatement()], [text])).toThrow(
        `The part with the hash ${text.sha2} belongs to no Attachment of the Statements.`,
      );
    });

    it("refuses an Attachment that has no fileUrl and no part", () => {
      expect(() => writeMultipart([statementWithAttachments([text])], [])).toThrow(
        `The Attachment with the hash ${text.sha2} has no fileUrl, and no part holds its data.`,
      );
    });
  });
});
