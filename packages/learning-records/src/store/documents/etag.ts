import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** The entity tags that an `If-Match` header names: `*` for any document that exists, or the tags of a list. */
export type Tags = "*" | readonly string[];

const TAG = String.raw`(?:W/)?"[\x21\x23-\x7e\x80-\xff]*"`;
const TAG_LIST = new RegExp(`^${TAG}(?:[ \\t]*,[ \\t]*${TAG})*$`, "u");
const TAG_OF_LIST = /(?:W\/)?"[^"]*"/gu;

/** Makes the entity tag of a document: the SHA-1 of its content in hex, in quotes (4.1.4). */
export function etagOf(body: Uint8Array): string {
  return `"${bytesToHex(sha1(body))}"`;
}

/**
 * Reads the header `If-Match` (RFC 9110 13.1.1): `*`, or a list of entity tags. A weak tag keeps its `W/`, so it is never
 * equal to the strong tag of a document, which is how the strong comparison of `If-Match` leaves it out.
 */
export function readIfMatch(header: string): Tags {
  const text = header.trim();
  if (text === "*") return "*";
  if (!TAG_LIST.test(text)) {
    throw new DataError(
      `The header If-Match must be * or a list of entity tags in quotes, such as "a1b2", found ${describe(header)}.`,
    );
  }
  return [...text.matchAll(TAG_OF_LIST)].map((match) => match[0]);
}

/** Reads the header `If-None-Match`, which only `*` may have: the document must not exist. */
export function readIfNoneMatch(header: string): "*" {
  if (header.trim() !== "*") {
    throw new DataError(`The header If-None-Match must be *, found ${describe(header)}.`);
  }
  return "*";
}

/** Tells whether the tags name the entity tag of a document that exists. */
export function tagsName(tags: Tags, etag: string): boolean {
  return tags === "*" || tags.includes(etag);
}
