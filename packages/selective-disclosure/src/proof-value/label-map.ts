import { DataError } from "@interopkit/core";
import { base64urlnopad } from "@scure/base";
import { LABEL_BYTES, MULTIBASE_BASE64URL } from "../suite.js";

/** The text before the number of a canonical blank node label: `c14n0`, `c14n1`. */
const CANONICAL_PREFIX = "c14n";

/**
 * Compresses a label map for a derived proof value (section 3.5.5): the number of each canonical label becomes the key and
 * the digest behind the HMAC label the value.
 */
export function compressLabelMap(labelMap: ReadonlyMap<string, string>): Map<number, Uint8Array> {
  const compressed = new Map<number, Uint8Array>();
  for (const [label, hmacLabel] of labelMap) {
    compressed.set(
      Number(label.slice(CANONICAL_PREFIX.length)),
      base64urlnopad.decode(hmacLabel.slice(MULTIBASE_BASE64URL.length)),
    );
  }
  return compressed;
}

/** Restores the label map that `compressLabelMap` made (section 3.5.6). */
export function decompressLabelMap(compressed: ReadonlyMap<number, Uint8Array>): Map<string, string> {
  const labelMap = new Map<string, string>();
  for (const [number, digest] of compressed) {
    labelMap.set(`${CANONICAL_PREFIX}${number}`, `${MULTIBASE_BASE64URL}${base64urlnopad.encode(digest)}`);
  }
  return labelMap;
}

/**
 * Checks the compressed label map of a derived proof value: a map from non-negative integers to digests of 32 bytes.
 *
 * @throws `DataError` when it is not.
 */
export function checkLabelMap(value: unknown): ReadonlyMap<number, Uint8Array> {
  if (!(value instanceof Map)) throw new DataError("The label map must be a CBOR map from integers to byte strings.");
  for (const [key, digest] of value) {
    if (!(typeof key === "number" && Number.isSafeInteger(key) && key >= 0)) {
      throw new DataError("The label map must have non-negative integers as keys.");
    }
    if (!(digest instanceof Uint8Array && digest.length === LABEL_BYTES)) {
      throw new DataError(`The label map must have byte strings of ${LABEL_BYTES} bytes as values.`);
    }
  }
  return value;
}
