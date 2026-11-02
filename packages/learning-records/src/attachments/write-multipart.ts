import { DataError } from "@interopkit/core";
import { checkArray, checkProperties, checkString, isRecord, parseWith } from "@interopkit/core/checks";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { AttachmentData, Statement, StatementResult } from "../model/index.js";
import { attachmentDataSchema, attachmentHeadersOf, readEitherVersion } from "../read/internal.js";
import { hashesTo } from "./attachment-hash.js";

const encoder = new TextEncoder();

/** The end of a line in a multipart message (RFC 2046 section 5.1.1). */
const CRLF = "\r\n";

/** The characters of the boundary that come from the hash of the message: 128 bits, far below the 70 characters of RFC 2046. */
const BOUNDARY_DIGITS = 32;

/** What `writeMultipart` returns: the `Content-Type` header of the request or the answer, and its body. */
export interface MultipartMessage {
  /** The `Content-Type` header, with the boundary. */
  readonly contentType: string;
  /** The bytes of the message. */
  readonly body: Uint8Array<ArrayBuffer>;
}

/** The Statements of the first part: one Statement for a PUT, an array for a POST, and a result for the answer to a query. */
export type MultipartStatements = Statement | readonly Statement[] | StatementResult;

/** The first part as text, and the Statements it holds. */
interface StatementsPart {
  readonly text: string;
  readonly statements: readonly Statement[];
}

/** Reads the first part from the three forms that it may take, checking every Statement as an LRS of either version reads it. */
function readStatementsPart(document: unknown): StatementsPart {
  if (Array.isArray(document)) {
    const statements = document.map((statement) => readEitherVersion(statement));
    return { text: JSON.stringify(statements), statements };
  }
  if (isRecord(document) && "statements" in document) {
    checkProperties(document, "The result", ["statements", "more"]);
    checkArray(document.statements, "The property statements of the result must be an array");
    if (document.more !== undefined) checkString(document.more, "The property more of the result");
    const statements = document.statements.map((statement) => readEitherVersion(statement));
    return {
      text: JSON.stringify({ statements, ...(document.more === undefined ? {} : { more: document.more }) }),
      statements,
    };
  }
  const statement = readEitherVersion(document);
  return { text: JSON.stringify(statement), statements: [statement] };
}

/** Reads the parts, and checks that each holds the data of its hash and that the parts and the Attachments belong together. */
function readParts(parts: unknown, statements: readonly Statement[]): readonly AttachmentData[] {
  checkArray(parts, "The parts must be an array");
  const data = parts.map((part, index) => parseWith(attachmentDataSchema, part, `The part ${index}`));
  const held = new Set<string>();
  for (const { sha2, body } of data) {
    if (!hashesTo(sha2, body)) throw new DataError(`The part with the hash ${sha2} holds data that have another hash.`);
    if (held.has(sha2.toLowerCase())) {
      throw new DataError(`Two parts have the hash ${sha2}: the data of an Attachment travel once.`);
    }
    held.add(sha2.toLowerCase());
  }
  const headers = statements.flatMap(attachmentHeadersOf);
  const named = new Set(headers.map(({ sha2 }) => sha2.toLowerCase()));
  for (const sha2 of held) {
    if (!named.has(sha2))
      throw new DataError(`The part with the hash ${sha2} belongs to no Attachment of the Statements.`);
  }
  for (const { sha2, fileUrl } of headers) {
    if (fileUrl === undefined && !held.has(sha2.toLowerCase())) {
      throw new DataError(`The Attachment with the hash ${sha2} has no fileUrl, and no part holds its data.`);
    }
  }
  return data;
}

/** Joins byte arrays into one. */
function join(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/**
 * Writes a `multipart/mixed` message of Statements and Attachments (4.1.3): the Statements as JSON in the first part, and the
 * data of each Attachment in a part with its `X-Experience-API-Hash`.
 *
 * @remarks
 * Every Statement is read as an LRS of either version reads it, and the message must be one that an LRS accepts: each part holds the data of
 * its hash, belongs to an Attachment of the Statements, and appears once; and each Attachment without a `fileUrl` has its part.
 * The boundary comes from the hash of the first part and of the hashes of the other parts, so the same input gives the same
 * message, and no part can hold the boundary, since it would have to hold its own hash. Each part after the first carries
 * `Content-Type`, `Content-Transfer-Encoding: binary` and `X-Experience-API-Hash`.
 *
 * @param statements - A Statement for a PUT, an array of them for a POST, or a result for the answer to a query.
 * @param parts - The data of the Attachments, each with the hash that its header names.
 * @returns The `Content-Type` header, with the boundary, and the body.
 * @throws `DataError` when a Statement is not valid, a part is not valid or holds data of another hash, or the parts and the
 * Attachments do not match.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function writeMultipart(statements: MultipartStatements, parts: readonly AttachmentData[]): MultipartMessage {
  const first = readStatementsPart(statements);
  const data = readParts(parts, first.statements);
  const seed = [first.text, ...data.map(({ sha2, contentType }) => `${sha2.toLowerCase()} ${contentType}`)].join(CRLF);
  const boundary = `interopkit-${bytesToHex(sha256(encoder.encode(seed))).slice(0, BOUNDARY_DIGITS)}`;
  const chunks: Uint8Array[] = [
    encoder.encode(`--${boundary}${CRLF}Content-Type: application/json${CRLF}${CRLF}${first.text}${CRLF}`),
  ];
  for (const { sha2, contentType, body } of data) {
    const headers = `Content-Type: ${contentType}${CRLF}Content-Transfer-Encoding: binary${CRLF}X-Experience-API-Hash: ${sha2.toLowerCase()}`;
    chunks.push(encoder.encode(`--${boundary}${CRLF}${headers}${CRLF}${CRLF}`), body, encoder.encode(CRLF));
  }
  chunks.push(encoder.encode(`--${boundary}--${CRLF}`));
  return { contentType: `multipart/mixed; boundary=${boundary}`, body: join(chunks) };
}
