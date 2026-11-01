import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { textToBake } from "./credential-text.js";
import { type BakeImageOptions, checkImageSize, limitsOf } from "./options.js";
import { type Chunk, chunksOf } from "./png-chunks.js";
import { kindOfChunk, TEXT_CHUNK, writeCredentialChunk } from "./png-text.js";

/**
 * Bakes a credential into a PNG image: inserts an `iTXt` chunk with the keyword `openbadgecredential`, or `clrcredential` for a
 * CLR, right after the `IHDR` chunk, and leaves every other byte as it was.
 *
 * @remarks
 * The kind follows the credential's `type`, and for a compact JWS the `type` in its payload. The chunk is not compressed, as
 * the specifications require. An object is checked with `readCredential` first, and a compact JWS only for its shape: baking
 * verifies nothing. Open Badges 2.0 assertions are read and never baked. The image is not changed; the result is a new array.
 * The image and the result are refused above `maxBytes`.
 *
 * @param image - The PNG.
 * @param credential - A compact JWS, or a credential that is not signed as an object.
 * @param options - Whether to replace a credential the image already holds, and the most bytes of the image.
 * @returns The baked image.
 * @throws `DataError` when the image is not a PNG, the credential is not valid, the image holds a credential and `replace` is
 * `false`, or the image or the result is larger than `maxBytes`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#baked-badge | Open Badges 3.0, Baked Badge}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/#image-format | CLR 2.0, Image Format}
 */
export function bakePng(image: Uint8Array, credential: string | object, options?: BakeImageOptions): Uint8Array {
  const { maxBytes, replace } = limitsOf(options, ["maxBytes", "replace"]);
  if (!(image instanceof Uint8Array)) throw new DataError(`The image must be a Uint8Array, found ${describe(image)}.`);
  checkImageSize(image.length, maxBytes, "The image");
  const { kind, text } = textToBake(credential);
  let insertAt = 0;
  const held: Chunk[] = [];
  for (const chunk of chunksOf(image)) {
    if (chunk.type === "IHDR") insertAt = chunk.end;
    else if (chunk.type === TEXT_CHUNK && kindOfChunk(image, chunk) !== undefined) held.push(chunk);
  }
  const [first] = held;
  if (first !== undefined && !replace) {
    throw new DataError(
      `The PNG image already holds a credential in the chunk at byte ${first.start}. Pass the option replace to replace it.`,
    );
  }
  const baked = writeCredentialChunk(kind, text);
  const size = image.length - held.reduce((sum, chunk) => sum + chunk.end - chunk.start, 0) + baked.length;
  checkImageSize(size, maxBytes, "The baked image");
  const result = new Uint8Array(size);
  result.set(image.subarray(0, insertAt));
  result.set(baked, insertAt);
  let written = insertAt + baked.length;
  let read = insertAt;
  for (const chunk of held) {
    result.set(image.subarray(read, chunk.start), written);
    written += chunk.start - read;
    read = chunk.end;
  }
  result.set(image.subarray(read), written);
  return result;
}
