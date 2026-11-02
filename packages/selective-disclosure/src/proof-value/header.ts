import { DataError } from "@interopkit/core";
import { base64urlnopad } from "@scure/base";
import { MULTIBASE_BASE64URL } from "../suite.js";

/**
 * The first bytes of a base proof value: the CBOR tag 0x5d00 (Data Integrity ECDSA Cryptosuites, section 3.5.2). 0xd9 is a
 * tag whose number takes 2 bytes, 0x5d is the first byte of the tag of the suite and the last byte says which proof it is.
 */
export const BASE_HEADER: Uint8Array = Uint8Array.of(0xd9, 0x5d, 0x00);

/** The first bytes of a derived proof value (section 3.5.7): the same tag as the base proof, ending 0x01. */
export const DERIVED_HEADER: Uint8Array = Uint8Array.of(0xd9, 0x5d, 0x01);

/**
 * The text that starts every proof value with a header. The 3 bytes of a header fill 4 characters exactly, so the text of
 * the header does not depend on the bytes after it.
 */
export function prefixOf(header: Uint8Array): string {
  return `${MULTIBASE_BASE64URL}${base64urlnopad.encode(header)}`;
}

/** Writes a header and a CBOR payload as a proof value: multibase base64url without padding. */
export function encodeProofValue(header: Uint8Array, payload: Uint8Array): string {
  const bytes = new Uint8Array(header.length + payload.length);
  bytes.set(header);
  bytes.set(payload, header.length);
  return `${MULTIBASE_BASE64URL}${base64urlnopad.encode(bytes)}`;
}

/**
 * Returns the CBOR payload that follows the header of a proof value.
 *
 * @param proofValue - The `proofValue` of a proof.
 * @param header - The header the value must start with.
 * @param kind - Names the kind of proof in the error message, such as `base`.
 * @throws `DataError` when the value is not a string, does not start with the header, or is not base64url.
 */
export function payloadOf(proofValue: unknown, header: Uint8Array, kind: string): Uint8Array {
  if (typeof proofValue !== "string") {
    throw new DataError(`The proofValue of a ${kind} proof must be a string, found ${typeof proofValue}.`);
  }
  const prefix = prefixOf(header);
  if (!proofValue.startsWith(prefix)) {
    throw new DataError(
      `The proofValue of a ${kind} proof must start with ${prefix}, the multibase base64url text of the header of the suite.`,
    );
  }
  try {
    return base64urlnopad.decode(proofValue.slice(prefix.length));
  } catch (cause) {
    throw new DataError(`The proofValue of a ${kind} proof is not base64url text without padding.`, { cause });
  }
}
