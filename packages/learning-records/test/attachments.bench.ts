import { createHash } from "node:crypto";
import { type AttachmentData, readStatement, type Statement } from "@interopkit/learning-records";
import { attachmentHash, readMultipart, writeMultipart } from "@interopkit/learning-records/attachments";
import { parseMultipart } from "@remix-run/multipart-parser";
import { expect, test } from "vitest";
import { benchStatement } from "./batch.js";
import { BENCH_OPTIONS, expectRatio, RATIOS } from "./budgets.js";

/** The Statements of the message: one fewer than the 100 parts that a message may have by default, the first being theirs. */
const ATTACHED = 99;

/** The bytes of the data of each Attachment: 64 KiB, so that the message holds 6.2 MiB of data, under the 10 MiB it may. */
const DATA_BYTES = 65_536;

/** The SHA-256 of node:crypto, in hexadecimal digits. */
const nativeSha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Data of the given size whose bytes follow from the number, so that no two parts are alike. */
function dataOf(n: number): AttachmentData {
  const body = new Uint8Array(DATA_BYTES).map((_, index) => (index * 31 + n * 7) % 251);
  return { sha2: nativeSha256(body), contentType: "application/octet-stream", body };
}

/** A Statement with one Attachment whose data is the given one. */
function attached(n: number, { sha2, contentType, body }: AttachmentData): Statement {
  return {
    ...readStatement(benchStatement(n)),
    attachments: [
      {
        usageType: "https://example.org/attachments/evidence",
        display: { "en-US": "Evidence" },
        contentType,
        length: body.byteLength,
        sha2,
      },
    ],
  };
}

test("writes and reads a message of 99 Statements with 6.2 MiB of Attachments within a few times of node:crypto", async ({
  annotate,
  bench,
}) => {
  const parts = Array.from({ length: ATTACHED }, (_, index) => dataOf(index + 1));
  const statements = parts.map((data, index) => attached(index + 1, data));
  const message = writeMultipart(statements, parts);
  const boundary = message.contentType.split("boundary=")[1] ?? "";
  await annotate(`The message has ${ATTACHED + 1} parts and ${message.body.byteLength} bytes.`);
  expect(readMultipart(message.contentType, message.body).parts.size).toBe(ATTACHED);

  // The least that a reader does: split the parts with the parser that readMultipart uses, and hash each with node:crypto.
  const split = await bench("parseMultipart and node:crypto", () => {
    for (const part of parseMultipart(message.body, { boundary })) nativeSha256(part.bytes);
  }).run(BENCH_OPTIONS);
  const read = await bench("readMultipart", () => readMultipart(message.contentType, message.body)).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "readMultipart",
    read,
    { ...split, name: "the parser with the hashes of node:crypto" },
    RATIOS.readMultipartAgainstNative,
  );

  // The least that a writer does: the JSON of the Statements, the hash of each part with node:crypto, and the bytes joined.
  const encoder = new TextEncoder();
  const joined = await bench("JSON, node:crypto and a copy", () => {
    const chunks = [encoder.encode(JSON.stringify(statements)), ...parts.map(({ body }) => body)];
    for (const { body } of parts) nativeSha256(body);
    const out = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }).run(BENCH_OPTIONS);
  const written = await bench("writeMultipart", () => writeMultipart(statements, parts)).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "writeMultipart",
    written,
    { ...joined, name: "the JSON, the hashes of node:crypto and a copy" },
    RATIOS.writeMultipartAgainstNative,
  );
});

test("hashes 1 MiB of an Attachment within a few times of the SHA-256 of node:crypto", async ({ annotate, bench }) => {
  const body = new Uint8Array(1_048_576).map((_, index) => index % 251);
  expect(attachmentHash(body)).toBe(nativeSha256(body));
  const native = await bench("node:crypto SHA-256", () => nativeSha256(body)).run(BENCH_OPTIONS);
  const hashed = await bench("attachmentHash", () => attachmentHash(body)).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "attachmentHash",
    hashed,
    { ...native, name: "the SHA-256 of node:crypto" },
    RATIOS.attachmentHashAgainstNative,
  );
});
