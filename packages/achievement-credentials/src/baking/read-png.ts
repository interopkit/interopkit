import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import type { BakedCredential } from "./baked-credential.js";
import { bakedValue } from "./credential-text.js";
import { FOUND_KINDS } from "./formats.js";
import { checkImageSize, limitsOf, type ReadImageOptions } from "./options.js";
import { chunksOf } from "./png-chunks.js";
import { kindOfChunk, LEGACY_TEXT_CHUNK, readCredentialChunk, readLegacyChunk, TEXT_CHUNK } from "./png-text.js";

/**
 * Reads the credential that a PNG image holds: the text of its first `iTXt` chunk with the keyword `openbadgecredential` or
 * `clrcredential`, as the specifications say to extract it, or of an Open Badges 2.0 assertion: an `iTXt` chunk with the keyword
 * `openbadges`, or a `tEXt` chunk with that keyword that holds the address of a hosted assertion.
 *
 * @remarks
 * The result is what the image holds and nothing has checked it: a compact JWS is text, and JSON is an object. Pass it to
 * `verifyCredential`, or to `readCredential` when it is an object. The image is refused before any chunk is read when it has
 * more than `maxBytes`. The reading stops at the first credential chunk, and its CRC-32 is checked; the other chunks are
 * walked and their framing is checked and nothing else. A compressed chunk is refused: the specifications forbid compression.
 *
 * @param image - The PNG.
 * @param options - The most bytes of the image.
 * @returns The credential and its kind, or `undefined` when the image holds none.
 * @throws `DataError` when the image is not a PNG, is truncated, is larger than the limit, or holds a credential chunk that is
 * damaged, compressed, or not a credential, or a legacy chunk that holds no address.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#baked-badge | Open Badges 3.0, Baked Badge}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/#image-format | CLR 2.0, Image Format}
 * @see {@link https://www.imsglobal.org/sites/default/files/Badges/OBv2p0Final/baking/index.html | Open Badges 2.0 Baking}
 */
export function readPng(image: Uint8Array, options?: ReadImageOptions): BakedCredential | undefined {
  const { maxBytes, maxTokens } = limitsOf(options, ["maxBytes", "maxTokens"]);
  if (!(image instanceof Uint8Array)) throw new DataError(`The image must be a Uint8Array, found ${describe(image)}.`);
  checkImageSize(image.length, maxBytes, "The image");
  for (const chunk of chunksOf(image)) {
    const kind = chunk.type === TEXT_CHUNK ? kindOfChunk(image, chunk, FOUND_KINDS) : undefined;
    if (kind !== undefined) return { kind, credential: bakedValue(readCredentialChunk(image, chunk, kind), maxTokens) };
    if (chunk.type === LEGACY_TEXT_CHUNK && kindOfChunk(image, chunk, ["badge-v2"]) !== undefined) {
      return { kind: "badge-v2", credential: readLegacyChunk(image, chunk) };
    }
  }
  return undefined;
}
