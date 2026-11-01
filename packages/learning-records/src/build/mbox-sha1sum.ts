import { DataError } from "@interopkit/core";
import { checkString, describe } from "@interopkit/core/checks";
import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { isMailtoIri } from "../model/internal.js";

/**
 * Returns the `mbox_sha1sum` of an email address: the SHA-1 hash of the `mailto` IRI, as 40 hexadecimal digits in lower case.
 *
 * @remarks
 * An Agent that is identified by the hash does not show the address, though anyone who can guess the address can compute the
 * hash. The standard asks for SHA-1; it is not used here to protect anything. The IRI is hashed as it is written: the standard
 * names no normalization.
 *
 * @param mailto - The address as a `mailto` IRI: `mailto:` and one email address.
 * @returns The hash.
 * @throws `DataError` when the text is not a `mailto` IRI with one address.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function mboxSha1sum(mailto: string): string {
  checkString(mailto, "The mailto IRI");
  if (!isMailtoIri(mailto)) {
    throw new DataError(`The mailto IRI must be "mailto:" and one email address, found ${describe(mailto)}.`);
  }
  return bytesToHex(sha1(utf8ToBytes(mailto)));
}
