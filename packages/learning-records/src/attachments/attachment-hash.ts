import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { sha224, sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** The SHA-2 function that writes a hash of each length in hexadecimal digits: 224, 256, 384 and 512 bits (FIPS 180-4). */
const HASH_BY_DIGITS = new Map<number, (data: Uint8Array) => Uint8Array>([
  [56, sha224],
  [64, sha256],
  [96, sha384],
  [128, sha512],
]);

/** Checks that a value is bytes, as the data of an Attachment are. */
export function checkBytes(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new DataError(`${label} must be a Uint8Array, found ${describe(value)}.`);
}

/**
 * Returns the SHA-2 hash of the data of an Attachment: SHA-256 as 64 hexadecimal digits in lower case, the `sha2` of its header
 * and the `X-Experience-API-Hash` of its part.
 *
 * @remarks
 * The standard says SHA-2 and leaves the length open; SHA-256 is what a Learning Record Provider writes. A reader accepts a
 * hash of 224, 384 or 512 bits too.
 *
 * @param body - The data.
 * @returns The hash.
 * @throws `DataError` when the data are not a `Uint8Array`.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function attachmentHash(body: Uint8Array): string {
  checkBytes(body, "The body");
  return bytesToHex(sha256(body));
}

/** Tells whether a SHA-2 hash written in hexadecimal digits, in either case, is the hash of the data. */
export function hashesTo(sha2: string, body: Uint8Array): boolean {
  const hash = HASH_BY_DIGITS.get(sha2.length);
  return hash !== undefined && bytesToHex(hash(body)) === sha2.toLowerCase();
}
