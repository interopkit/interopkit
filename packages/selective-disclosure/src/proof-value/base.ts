import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { encode } from "cborg";
import { HMAC_KEY_BYTES } from "../suite.js";
import { readComponents } from "./cbor.js";
import { checkBaseSignature, checkBytes, checkPublicKey, checkSignatures } from "./fields.js";
import { BASE_HEADER, encodeProofValue, payloadOf } from "./header.js";

/** What a base proof value holds (Data Integrity ECDSA Cryptosuites, section 3.5.2). */
export interface BaseProofValue {
  /** The signature of the issuer's key over the proof options, the proof key and the mandatory statements. */
  readonly baseSignature: Uint8Array;
  /** The public key of the proof, in multikey form. */
  readonly publicKey: Uint8Array;
  /** The key of the HMAC that gives blank nodes their labels. */
  readonly hmacKey: Uint8Array;
  /** The signature of the proof key over each statement that is not mandatory, in the order of the statements. */
  readonly signatures: readonly Uint8Array[];
  /** The JSON pointers to what a holder always reveals. */
  readonly mandatoryPointers: readonly string[];
}

/** Writes a base proof value: the header and the CBOR array of its five components. */
export function serializeBaseProofValue(value: BaseProofValue): string {
  const { baseSignature, publicKey, hmacKey, signatures, mandatoryPointers } = value;
  return encodeProofValue(BASE_HEADER, encode([baseSignature, publicKey, hmacKey, signatures, mandatoryPointers]));
}

/**
 * Reads a base proof value (section 3.5.3).
 *
 * @param proofValue - The `proofValue` of a base proof.
 * @returns Its five components.
 * @throws `DataError` when it is not a base proof value: another header, not CBOR, or components of the wrong kind or length.
 */
export function parseBaseProofValue(proofValue: unknown): BaseProofValue {
  const [baseSignature, publicKey, hmacKey, signatures, mandatoryPointers] = readComponents(
    payloadOf(proofValue, BASE_HEADER, "base"),
    5,
    "base",
  );
  if (!(Array.isArray(mandatoryPointers) && mandatoryPointers.every((pointer) => typeof pointer === "string"))) {
    throw new DataError(`The mandatoryPointers must be an array of strings, found ${describe(mandatoryPointers)}.`);
  }
  return {
    baseSignature: checkBaseSignature(baseSignature),
    publicKey: checkPublicKey(publicKey),
    hmacKey: checkBytes(hmacKey, HMAC_KEY_BYTES, "The hmacKey"),
    signatures: checkSignatures(signatures),
    mandatoryPointers,
  };
}
