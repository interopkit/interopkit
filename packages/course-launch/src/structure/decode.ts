import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";

/** The encodings of a course structure that the reader takes: those that every XML processor must read. */
export type StructureEncoding = "utf-8" | "utf-16le" | "utf-16be";

/** A course structure as text, and the encoding of its bytes when it came as bytes. */
export interface DecodedStructure {
  readonly text: string;
  /** The encoding of the bytes, or `undefined` for a structure that came as a string. */
  readonly encoding: StructureEncoding | undefined;
}

/** The byte order marks of the encodings, longest first. */
const BYTE_ORDER_MARKS: readonly (readonly [StructureEncoding, readonly number[]])[] = [
  ["utf-8", [0xef, 0xbb, 0xbf]],
  ["utf-16le", [0xff, 0xfe]],
  ["utf-16be", [0xfe, 0xff]],
];

/** The byte order mark as a character, which the text of a string may start with. */
const BYTE_ORDER_MARK = "﻿";

/** The first code units that UTF-8 writes in two and in three bytes. */
const TWO_BYTES = 0x80;
const THREE_BYTES = 0x800;

/** Tells whether a code unit is the low half of a surrogate pair; `NaN`, past the end of a string, is not. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Tells whether a string has more bytes in UTF-8 than a limit, and stops counting once it does. */
function utf8BytesOver(text: string, limit: number): boolean {
  if (text.length > limit) return true;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < TWO_BYTES) bytes += 1;
    else if (code < THREE_BYTES) bytes += 2;
    // A high surrogate and its low surrogate are one character of four bytes; a lone one is written as U+FFFD, in three.
    else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(text.charCodeAt(index + 1))) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > limit) return true;
  }
  return false;
}

/** Finds the encoding of bytes by their byte order mark, UTF-8 without one. */
function encodingOf(bytes: Uint8Array): StructureEncoding {
  for (const [encoding, mark] of BYTE_ORDER_MARKS) {
    if (mark.every((byte, index) => bytes[index] === byte)) return encoding;
  }
  return "utf-8";
}

/**
 * Turns a course structure into text within a limit of bytes: a string as it is, bytes as UTF-8, or as UTF-16 when a byte order
 * mark says so, decoded strictly. The byte order mark is not part of the text.
 *
 * @throws `DataError` when the structure is neither a string nor bytes, is above the limit, or is not valid in its encoding.
 */
export function decodeStructure(input: unknown, maxBytes: number): DecodedStructure {
  if (typeof input === "string") {
    if (utf8BytesOver(input, maxBytes)) {
      throw new DataError(`The course structure has more than ${maxBytes} bytes, the limit of the option maxBytes.`);
    }
    return { text: input.startsWith(BYTE_ORDER_MARK) ? input.slice(1) : input, encoding: undefined };
  }
  if (!(input instanceof Uint8Array)) {
    throw new DataError(`The course structure must be a string or a Uint8Array, found ${describe(input)}.`);
  }
  if (input.byteLength > maxBytes) {
    throw new DataError(
      `The course structure has ${input.byteLength} bytes, above the limit of ${maxBytes} bytes of the option maxBytes.`,
    );
  }
  const encoding = encodingOf(input);
  try {
    return { text: new TextDecoder(encoding, { fatal: true }).decode(input), encoding };
  } catch {
    throw new DataError(`The course structure is not valid ${encoding.toUpperCase()}: its bytes cannot be decoded.`);
  }
}

/** The names that an XML declaration may give each encoding, in lower case. */
const DECLARED_NAMES: Readonly<Record<StructureEncoding, readonly string[]>> = {
  "utf-8": ["utf-8"],
  "utf-16le": ["utf-16", "utf-16le"],
  "utf-16be": ["utf-16", "utf-16be"],
};

/** The names that the XML declaration of a structure that came as a string may give. */
const STRING_NAMES: readonly string[] = ["utf-8", "utf-16", "utf-16le", "utf-16be"];

/**
 * Checks the encoding that the XML declaration of a structure names against the encoding its bytes were read in: a string
 * may name UTF-8 or UTF-16, and no structure may name another, which the reader does not read.
 *
 * @throws `DataError` when the declaration names an encoding that the structure is not in.
 */
export function checkDeclaredEncoding(declared: string | undefined, encoding: StructureEncoding | undefined): void {
  if (declared === undefined) return;
  const name = declared.toLowerCase();
  const allowed = encoding === undefined ? STRING_NAMES : DECLARED_NAMES[encoding];
  if (!allowed.includes(name)) {
    throw new DataError(
      `The course structure declares the encoding ${JSON.stringify(declared)}, and it ${encoding === undefined ? "may declare UTF-8 or UTF-16" : `is in ${encoding.toUpperCase()}`}: write it in UTF-8 and declare that.`,
    );
  }
}
