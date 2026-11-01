import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readMultipart, writeMultipart } from "../src/attachments/index.js";
import type { AttachmentData } from "../src/index.js";
import { RUNS, returnsOrRefuses } from "./fuzz.js";
import { dataOf, messageOf, sha2Of, statementWithAttachments } from "./multipart.js";

const BOUNDARY = "fuzz-boundary";
const CONTENT_TYPE = `multipart/mixed; boundary=${BOUNDARY}`;

/** Media types, with parameters and a quoted one, that a part may name. */
const MEDIA_TYPES = [
  "text/plain",
  "application/octet-stream",
  "image/png",
  'application/pdf; name="a b.pdf"',
  "text/plain; charset=utf-8",
];

/** The data of Attachments with different hashes, of any bytes, among them the bytes of a boundary and of line ends. */
const attachments: fc.Arbitrary<AttachmentData[]> = fc
  .array(
    fc.tuple(
      fc.oneof(
        fc.uint8Array({ maxLength: 120 }),
        fc.constantFrom("\r\n", `\r\n--${BOUNDARY}`, "--", "\r\n\r\n").map((text) => new TextEncoder().encode(text)),
      ),
      fc.constantFrom(...MEDIA_TYPES),
    ),
    { maxLength: 6 },
  )
  .map((items) => [
    ...new Map(items.map(([body, contentType]) => [sha2Of(body), { sha2: sha2Of(body), contentType, body }])).values(),
  ]);

describe("the reader of a multipart message on any bytes", () => {
  it("returns the content or refuses with a DataError, for any bytes and any content type", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ maxLength: 400 }),
        fc.oneof(fc.constant(CONTENT_TYPE), fc.string()),
        (bytes, contentType) => {
          returnsOrRefuses(() => readMultipart(contentType, bytes));
        },
      ),
      RUNS,
    );
  });

  it("returns the content or refuses with a DataError, for a message with bytes changed, cut or added", () => {
    const text = dataOf("a part to damage");
    const message = messageOf(BOUNDARY, JSON.stringify([statementWithAttachments([text])]), [
      {
        headers: [
          "Content-Type: text/plain",
          "Content-Transfer-Encoding: binary",
          `X-Experience-API-Hash: ${text.sha2}`,
        ],
        body: "a part to damage",
      },
    ]);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: message.length }),
        fc.integer({ min: 0, max: 8 }),
        fc.uint8Array({ maxLength: 8 }),
        (at, remove, insert) => {
          const damaged = Uint8Array.from([...message.slice(0, at), ...insert, ...message.slice(at + remove)]);
          returnsOrRefuses(() => readMultipart(CONTENT_TYPE, damaged));
        },
      ),
      RUNS,
    );
  });
});

describe("the writer and the reader of a multipart message", () => {
  it("read back exactly the data that were written, whatever the bytes", () => {
    fc.assert(
      fc.property(attachments, (data) => {
        const written = writeMultipart([statementWithAttachments(data)], data);
        const { statements, parts } = readMultipart(written.contentType, written.body);
        expect(statements).toStrictEqual([statementWithAttachments(data)]);
        expect([...parts.values()]).toStrictEqual(data);
      }),
      RUNS,
    );
  });

  it("write a boundary that none of the parts holds", () => {
    fc.assert(
      fc.property(attachments, (data) => {
        const { contentType, body } = writeMultipart([statementWithAttachments(data)], data);
        const boundary = `--${contentType.split("boundary=")[1]}`;
        const delimiters = new TextDecoder("latin1").decode(body).split(boundary).length - 1;
        expect(delimiters).toBe(data.length + 2);
      }),
      RUNS,
    );
  });
});
