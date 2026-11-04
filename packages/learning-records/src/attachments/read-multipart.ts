import { DataError, LimitError } from "@interopkit/core";
import { checkString, describe } from "@interopkit/core/checks";
import {
  getMultipartBoundary,
  MaxFileSizeExceededError,
  MaxHeaderSizeExceededError,
  MaxPartsExceededError,
  MaxTotalSizeExceededError,
  type MultipartHeaders,
  MultipartParseError,
  type MultipartPart,
  parseMultipart,
} from "@remix-run/multipart-parser";
import type { AttachmentData } from "../model/index.js";
import { isMediaType, isSha2Hex, mediaTypeOf } from "../model/internal.js";
import { parseStatementJson } from "../read/index.js";
import { checkBytes, hashesTo } from "./hash-attachment.js";
import { type MultipartLimits, readLimits } from "./limits.js";

const MULTIPART_MIXED = "multipart/mixed";
const JSON_TYPE = "application/json";

/** The type of a part that names none: the data of an Attachment are bytes (4.1.3). */
const BINARY_TYPE = "application/octet-stream";

const decoder = new TextDecoder("utf-8", { fatal: true });

/** The most bytes of the headers of one part, the default of the parser, which a request of xAPI does not come near. */
const MAX_HEADER_BYTES = 8192;

/** What `readMultipart` finds in a message. */
export interface MultipartContent {
  /** The parsed JSON of the first part: a Statement, an array of them or a result. It is not yet read as a Statement. */
  readonly statements: unknown;
  /** The data of the other parts by their hash in lower case. */
  readonly parts: ReadonlyMap<string, AttachmentData>;
}

/** Returns the boundary of a `multipart/mixed` content type. */
function boundaryOf(contentType: string): string {
  if (mediaTypeOf(contentType) !== MULTIPART_MIXED) {
    throw new DataError(`The content type must be ${MULTIPART_MIXED}, found ${describe(contentType)}.`);
  }
  const boundary = getMultipartBoundary(contentType);
  if (boundary === null || boundary === "") {
    throw new DataError(`The content type ${describe(contentType)} has no boundary parameter.`);
  }
  return boundary;
}

/** Names the limit that a parser error reports, with its value, or none when the message is malformed. */
function limitOf(
  error: MultipartParseError,
  limits: Required<MultipartLimits>,
): { readonly limit: string; readonly maximum: number } | undefined {
  if (error instanceof MaxPartsExceededError) return { limit: "maxParts", maximum: limits.maxParts };
  if (error instanceof MaxFileSizeExceededError) return { limit: "maxPartBytes", maximum: limits.maxPartBytes };
  if (error instanceof MaxTotalSizeExceededError) return { limit: "maxTotalBytes", maximum: limits.maxTotalBytes };
  return error instanceof MaxHeaderSizeExceededError
    ? { limit: "maxHeaderBytes", maximum: MAX_HEADER_BYTES }
    : undefined;
}

/** Splits the message into its parts, within the limits. */
function splitParts(body: Uint8Array, boundary: string, limits: Required<MultipartLimits>): MultipartPart[] {
  try {
    return [
      ...parseMultipart(body, {
        boundary,
        maxHeaderSize: MAX_HEADER_BYTES,
        maxParts: limits.maxParts,
        maxFileSize: limits.maxPartBytes,
        maxTotalSize: limits.maxTotalBytes,
      }),
    ];
  } catch (error) {
    if (!(error instanceof MultipartParseError)) throw error;
    const message = `The multipart message is not valid: ${error.message}.`;
    const over = limitOf(error, limits);
    throw over === undefined
      ? new DataError(message, { cause: error })
      : new LimitError(message, over.limit, over.maximum, { cause: error });
  }
}

/** Returns the headers of a part. The parser decodes them when they are asked for, and refuses bytes that are not UTF-8. */
function headersOf(part: MultipartPart): MultipartHeaders {
  try {
    return part.headers;
  } catch (error) {
    throw new DataError("A part has a header that is not valid UTF-8 text.", { cause: error });
  }
}

/** Reads the first part, which holds the Statements as JSON. */
function readStatementsPart(part: MultipartPart, limits: Required<MultipartLimits>): unknown {
  const contentType = headersOf(part)["content-type"];
  if (contentType !== undefined && mediaTypeOf(contentType) !== JSON_TYPE) {
    throw new DataError(`The first part must be ${JSON_TYPE}, found ${describe(contentType)}.`);
  }
  let text: string;
  try {
    text = decoder.decode(part.bytes);
  } catch (error) {
    throw new DataError("The first part is not valid UTF-8 text, which JSON must be.", { cause: error });
  }
  return parseStatementJson(text, {
    maxBytes: limits.maxPartBytes,
    maxDepth: limits.maxDepth,
    maxTokens: limits.maxTokens,
  });
}

/** Reads a part after the first as the data of an Attachment, and checks them against the hash that the part declares. */
function readAttachmentPart(part: MultipartPart): AttachmentData {
  const headers = headersOf(part);
  const hash = headers["x-experience-api-hash"];
  if (hash === undefined) {
    throw new DataError(
      "A part after the first has no X-Experience-API-Hash header, which names the Attachment it holds.",
    );
  }
  if (!isSha2Hex(hash)) {
    throw new DataError(
      `The X-Experience-API-Hash of a part must be a SHA-2 hash in hexadecimal digits, found ${describe(hash)}.`,
    );
  }
  const encoding = headers["content-transfer-encoding"];
  if (encoding !== undefined && encoding.trim().toLowerCase() !== "binary") {
    throw new DataError(`The Content-Transfer-Encoding of a part must be binary, found ${describe(encoding)}.`);
  }
  const contentType = headers["content-type"] ?? BINARY_TYPE;
  if (!isMediaType(contentType)) {
    throw new DataError(`The Content-Type of a part must be an Internet media type, found ${describe(contentType)}.`);
  }
  const body = part.bytes;
  const length = headers["content-length"];
  if (length !== undefined && length.trim() !== String(body.byteLength)) {
    throw new DataError(
      `The part with the hash ${hash} declares ${describe(length)} bytes and holds ${body.byteLength}.`,
    );
  }
  if (!hashesTo(hash, body)) {
    throw new DataError(`The part with the hash ${hash} holds data that have another hash.`);
  }
  return { sha2: hash.toLowerCase(), contentType, body };
}

/**
 * Reads a `multipart/mixed` message of Statements and Attachments (4.1.3): the Statements of the first part, and the data of
 * each other part by its hash.
 *
 * @remarks
 * The first part is read with `parseStatementJson`, so a property given twice is refused and the limits of that function
 * apply. Each other part needs an `X-Experience-API-Hash`, and its data must have that hash: a part is matched to the
 * Attachment of a Statement by the hash and in no other way. `Content-Transfer-Encoding` is `binary` when it is absent. A part
 * with no `Content-Type` is `application/octet-stream`, and the `contentType` of the Attachment in the Statement is the one
 * that counts. Two parts with one hash hold the same data, and the first is kept. Nothing is matched to the Statements: the
 * caller reads them with `readStatement` or `validateStatements` and looks up the `sha2` of each Attachment in `parts`. A
 * message over a limit is refused with the same `DataError` as a malformed one.
 *
 * @param contentType - The `Content-Type` header of the request or the answer.
 * @param body - The bytes of the message.
 * @param options - The limits.
 * @returns The Statements as parsed JSON, and the data of the Attachments.
 * @throws `DataError` when the content type is not `multipart/mixed` with a boundary, the message is malformed or over a
 * limit, a part has no valid hash header or holds data that have another hash, or the first part is not valid JSON.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function readMultipart(contentType: string, body: Uint8Array, options?: MultipartLimits): MultipartContent {
  checkString(contentType, "The content type");
  checkBytes(body, "The body");
  const limits = readLimits(options);
  const [first, ...others] = splitParts(body, boundaryOf(contentType), limits);
  if (first === undefined) {
    throw new DataError("The multipart message has no part, and its first part must hold the Statements.");
  }
  const statements = readStatementsPart(first, limits);
  const parts = new Map<string, AttachmentData>();
  for (const part of others) {
    const data = readAttachmentPart(part);
    if (!parts.has(data.sha2)) parts.set(data.sha2, data);
  }
  return { statements, parts };
}
