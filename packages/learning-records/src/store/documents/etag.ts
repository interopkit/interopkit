import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** The entity tags that `If-Match` or `If-None-Match` names: `*` for any document that exists, or the members of a list. */
export type Tags = "*" | readonly string[];

/** Makes the entity tag of a document: the SHA-1 of its content in hex, in quotes (4.1.4). */
export function etagOf(body: Uint8Array): string {
  return `"${bytesToHex(sha1(body))}"`;
}

/**
 * Reads the header of a precondition (RFC 9110 13.1.1): `*`, or a comma-separated list of entity tags.
 *
 * @remarks
 * A member is compared as it was written, with its quotes, to the tag of the document, so a member that is not a well-formed
 * entity tag, such as one without quotes, is a tag that the document does not have and a precondition that fails (412) and
 * not a request that is refused (400). A weak tag keeps its `W/`, so it never equals the strong tag of a document, which is how
 * the strong comparison of `If-Match` leaves it out.
 */
export function readTags(header: string): Tags {
  const text = header.trim();
  if (text === "*") return "*";
  const members: string[] = [];
  for (const match of text.matchAll(/(?:W\/)?"[^"]*"|[^,\s][^,]*/gu)) members.push(match[0].trim());
  return members;
}

/** Tells whether the tags name the entity tag of a document that exists. */
export function tagsName(tags: Tags, etag: string): boolean {
  return tags === "*" || tags.includes(etag);
}

/** Refuses the header `If-None-Match` of a request that has no use for it, such as a `DELETE`. */
export function refuseIfNoneMatch(header: string | undefined): void {
  if (header !== undefined) {
    throw new DataError(`A DELETE takes If-Match, not If-None-Match, found ${describe(header)}.`);
  }
}
