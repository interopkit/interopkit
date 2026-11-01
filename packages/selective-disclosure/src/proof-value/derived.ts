import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { encode } from "cborg";
import { readComponents } from "./cbor.js";
import { checkBaseSignature, checkPublicKey, checkSignatures } from "./fields.js";
import { DERIVED_HEADER, encodeProofValue, payloadOf } from "./header.js";
import { checkLabelMap, compressLabelMap, decompressLabelMap } from "./label-map.js";

/** What a derived proof value holds (Data Integrity ECDSA Cryptosuites, section 3.5.7). */
export interface DerivedProofValue {
  /** The signature of the issuer's key, as the base proof holds it. */
  readonly baseSignature: Uint8Array;
  /** The public key of the proof, in multikey form. */
  readonly publicKey: Uint8Array;
  /** The signature of the proof key over each revealed statement that is not mandatory, in the order of the statements. */
  readonly signatures: readonly Uint8Array[];
  /** The label of each blank node as the verifier canonicalizes it (`c14n0`), mapped to the label that was signed. */
  readonly labelMap: ReadonlyMap<string, string>;
  /** Which of the revealed statements are mandatory: their positions in the canonical statements of the revealed document. */
  readonly mandatoryIndexes: readonly number[];
}

/** Writes a derived proof value: the header and the CBOR array of its five components. */
export function serializeDerivedProofValue(value: DerivedProofValue): string {
  const { baseSignature, publicKey, signatures, labelMap, mandatoryIndexes } = value;
  return encodeProofValue(
    DERIVED_HEADER,
    encode([baseSignature, publicKey, signatures, compressLabelMap(labelMap), mandatoryIndexes]),
  );
}

/**
 * Reads a derived proof value (section 3.5.8).
 *
 * @param proofValue - The `proofValue` of a derived proof.
 * @returns Its five components, with the label map restored.
 * @throws `DataError` when it is not a derived proof value: another header, not CBOR, or components of the wrong kind or length.
 */
export function parseDerivedProofValue(proofValue: unknown): DerivedProofValue {
  const [baseSignature, publicKey, signatures, labelMap, mandatoryIndexes] = readComponents(
    payloadOf(proofValue, DERIVED_HEADER, "derived"),
    5,
    "derived",
  );
  if (!(Array.isArray(mandatoryIndexes) && mandatoryIndexes.every(isIndex))) {
    throw new DataError(
      `The mandatoryIndexes must be an array of non-negative integers, found ${describe(mandatoryIndexes)}.`,
    );
  }
  return {
    baseSignature: checkBaseSignature(baseSignature),
    publicKey: checkPublicKey(publicKey),
    signatures: checkSignatures(signatures),
    labelMap: decompressLabelMap(checkLabelMap(labelMap)),
    mandatoryIndexes,
  };
}

/** Tells whether a value is the position of a statement: a non-negative safe integer. */
function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
