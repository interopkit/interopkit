import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { MULTIKEY_P256_HEADER, PUBLIC_KEY_BYTES, SIGNATURE_BYTES } from "../suite.js";

/** Says what a value is, in the words of an error message: a byte string by its length, anything else by `describe`. */
function found(value: unknown): string {
  return value instanceof Uint8Array ? `a byte string of ${value.length} bytes` : describe(value);
}

/** Checks a byte string of a fixed length. */
export function checkBytes(value: unknown, length: number, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new DataError(`${label} must be a byte string of ${length} bytes, found ${found(value)}.`);
  }
  return value;
}

/** Checks the signature of the issuer's key over the proof. */
export function checkBaseSignature(value: unknown): Uint8Array {
  return checkBytes(value, SIGNATURE_BYTES, "The baseSignature");
}

/** Checks the multikey form of the public key that is scoped to the proof: the header of `p256-pub` and a compressed point. */
export function checkPublicKey(value: unknown): Uint8Array {
  const key = checkBytes(value, PUBLIC_KEY_BYTES, "The publicKey");
  if (!MULTIKEY_P256_HEADER.every((byte, index) => key[index] === byte)) {
    throw new DataError("The publicKey must start with the multikey header of a P-256 key, 0x80 0x24.");
  }
  return key;
}

/** Checks the signatures of statements: a list of byte strings, one for each statement that can be hidden. */
export function checkSignatures(value: unknown): readonly Uint8Array[] {
  if (!Array.isArray(value)) throw new DataError(`The signatures must be an array, found ${describe(value)}.`);
  return value.map((signature, index) => checkBytes(signature, SIGNATURE_BYTES, `The signature ${index}`));
}
