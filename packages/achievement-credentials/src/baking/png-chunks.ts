import { DataError } from "@interopkit/core";

/** The eight bytes that start every PNG file (PNG 1.2, section 5.2). */
const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** The most bytes that the length field of a chunk may hold: an integer of 31 bits (PNG 1.2, section 5.3). */
const MAX_CHUNK_LENGTH = 0x7fff_ffff;

/** The bytes of a chunk besides its data: the length, the type and the CRC-32, four each. */
const FRAME_BYTES = 12;

/** Where one chunk of a PNG is, as indexes into the image. */
export interface Chunk {
  /** The four letters of its type, such as `IHDR` or `iTXt`. */
  readonly type: string;
  /** The index of its length field. */
  readonly start: number;
  /** The index of its first byte of data. */
  readonly dataStart: number;
  /** The index after its last byte of data, where its CRC-32 is. */
  readonly dataEnd: number;
  /** The index after its CRC-32, where the next chunk starts. */
  readonly end: number;
}

/** Checks that the image starts with the PNG signature. */
function checkSignature(image: Uint8Array): void {
  if (image.length < SIGNATURE.length || SIGNATURE.some((byte, at) => image[at] !== byte)) {
    throw new DataError("The image is not a PNG: it does not start with the eight bytes of the PNG signature.");
  }
}

/** Reads the framing of the chunk that starts at `start`, and checks that it fits in the image. */
function chunkAt(image: Uint8Array, view: DataView, start: number, first: boolean): Chunk {
  if (start === image.length) throw new DataError("The PNG image ends without an IEND chunk: it is truncated.");
  if (start + FRAME_BYTES > image.length) {
    throw new DataError(`The PNG image ends inside the chunk at byte ${start}: it is truncated.`);
  }
  const length = view.getUint32(start);
  const type = String.fromCharCode(...image.subarray(start + 4, start + 8));
  if (length > MAX_CHUNK_LENGTH) {
    throw new DataError(`The ${type} chunk at byte ${start} claims ${length} bytes, more than a chunk may hold.`);
  }
  const end = start + FRAME_BYTES + length;
  if (end > image.length) {
    throw new DataError(`The ${type} chunk at byte ${start} claims ${length} bytes, more than the image holds.`);
  }
  if (first && type !== "IHDR") {
    throw new DataError(`The first chunk of a PNG must be IHDR, found ${type} at byte ${start}.`);
  }
  return { type, start, dataStart: start + 8, dataEnd: start + 8 + length, end };
}

/**
 * Walks the chunks of a PNG in order, from the first to `IEND`, and checks their framing: the signature, that the first
 * chunk is `IHDR`, that every chunk fits in the image, and that the last is `IEND`. The data and the CRC-32 of a chunk are the
 * caller's to check, and nothing is copied: a chunk is where it lies in the image.
 *
 * @param image - The PNG.
 * @throws `DataError` that says what is wrong with the image and where.
 */
export function* chunksOf(image: Uint8Array): Generator<Chunk, void, void> {
  checkSignature(image);
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  let chunk = chunkAt(image, view, SIGNATURE.length, true);
  yield chunk;
  while (chunk.type !== "IEND") {
    chunk = chunkAt(image, view, chunk.end, false);
    yield chunk;
  }
}
