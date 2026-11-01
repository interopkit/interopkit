import { DataError } from "@interopkit/core";
import { crc32 } from "./crc32.js";
import { BAKED_KINDS, type BakedKind, FORMATS } from "./formats.js";
import type { Chunk } from "./png-chunks.js";

const ENCODER = new TextEncoder();
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** The type of the chunk that holds international text (PNG 1.2, section 11.3.4.5). */
export const TEXT_CHUNK = "iTXt";

/** The keywords of the kinds as bytes: the chunk starts with one and a null byte. */
const KEYWORDS = BAKED_KINDS.map((kind) => [kind, ENCODER.encode(FORMATS[kind].keyword)] as const);

/**
 * The bytes of an `iTXt` chunk between its keyword and its text: the null byte that ends the keyword, the compression flag
 * and method (both 0, since compression must not be used), and the empty language tag and translated keyword with their null
 * bytes. Open Badges 3.0 example 2 writes the same fields.
 */
const UNCOMPRESSED_FIELDS = 5;

/** The bytes of a chunk besides its data: the length, the type and the CRC-32, four each. */
const FRAME_BYTES = 12;

/** Tells which kind a chunk is the credential of by its keyword, and whether it is one at all. */
export function kindOfChunk(image: Uint8Array, chunk: Chunk): BakedKind | undefined {
  return KEYWORDS.find(
    ([, keyword]) =>
      chunk.dataEnd - chunk.dataStart > keyword.length &&
      image[chunk.dataStart + keyword.length] === 0 &&
      keyword.every((byte, at) => image[chunk.dataStart + at] === byte),
  )?.[0];
}

/**
 * Reads the text of the chunk that holds a credential, after checking its CRC-32 and that it is not compressed.
 *
 * @param image - The PNG.
 * @param chunk - An `iTXt` chunk whose keyword is that of `kind`.
 * @param kind - The kind that the keyword names.
 * @throws `DataError` when the chunk fails its CRC-32, is compressed, lacks its fields, or its text is not UTF-8.
 */
export function readCredentialChunk(image: Uint8Array, chunk: Chunk, kind: BakedKind): string {
  const { keyword } = FORMATS[kind];
  const label = `The ${keyword} chunk at byte ${chunk.start}`;
  const stored = new DataView(image.buffer, image.byteOffset + chunk.dataEnd, 4).getUint32(0);
  if (crc32(image.subarray(chunk.start + 4, chunk.dataEnd)) !== stored) {
    throw new DataError(`${label} fails its CRC-32, so the image is damaged.`);
  }
  const flags = chunk.dataStart + keyword.length + 1;
  // Compression is refused and not undone: the specifications forbid it, and inflating a chunk of an image is a bomb.
  if (flags + 2 > chunk.dataEnd || image[flags] !== 0 || image[flags + 1] !== 0) {
    throw new DataError(`${label} is compressed or lacks its fields, and the specifications forbid compression.`);
  }
  let text = flags + 2;
  // The language tag and the translated keyword each end with a null byte, and say nothing of the credential.
  for (let field = 0; field < 2; field += 1) {
    const end = image.subarray(text, chunk.dataEnd).indexOf(0);
    if (end === -1)
      throw new DataError(`${label} lacks the language tag or the translated keyword that ends its fields.`);
    text += end + 1;
  }
  try {
    return UTF8.decode(image.subarray(text, chunk.dataEnd));
  } catch {
    throw new DataError(`${label} holds text that is not UTF-8.`);
  }
}

/**
 * Writes the `iTXt` chunk that holds a credential: its length, type, keyword, fields, text and CRC-32.
 *
 * @param kind - The kind, which names the keyword.
 * @param text - The compact JWS or the JSON of the credential, which `MAX_CREDENTIAL_CHARACTERS` keeps far below the length that
 * a chunk may hold.
 */
export function writeCredentialChunk(kind: BakedKind, text: string): Uint8Array {
  const keyword = ENCODER.encode(FORMATS[kind].keyword);
  const body = ENCODER.encode(text);
  const length = keyword.length + UNCOMPRESSED_FIELDS + body.length;
  const chunk = new Uint8Array(FRAME_BYTES + length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, length);
  chunk.set(ENCODER.encode(TEXT_CHUNK), 4);
  chunk.set(keyword, 8);
  chunk.set(body, 8 + keyword.length + UNCOMPRESSED_FIELDS);
  view.setUint32(8 + length, crc32(chunk.subarray(4, 8 + length)));
  return chunk;
}
