import { DataError } from "@interopkit/core";
import { copyJson, type JsonObject } from "@interopkit/core/checks";

/** A document, or a proof, as the functions of the package take it: JSON that they read and do not change. */
export type JsonDocument = Readonly<Record<string, unknown>>;

const encoder = new TextEncoder();

/** The size of a JSON value as text, in UTF-8 bytes. */
export function jsonBytes(value: JsonObject): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/**
 * Reads a document or a proof that a function of the package works on: a copy that shares nothing with the input.
 *
 * @param value - The document, or its proof.
 * @param label - Names the value in an error message, such as `The document`.
 * @throws `DataError` when the value is not JSON, or nests more than `MAX_JSON_DEPTH` levels.
 */
export function readJson(value: JsonDocument, label: string): JsonObject {
  const copy = copyJson(value, "");
  if ("problem" in copy) throw new DataError(`${label} must be JSON, but ${copy.problem}.`);
  return copy.value;
}

/**
 * Checks that a document with its proof is not larger than the caller allows.
 *
 * @param size - The bytes of the document and its proof, as JSON.
 * @param maxBytes - The most bytes allowed.
 * @throws `DataError` when it is larger.
 */
export function checkSize(size: number, maxBytes: number): void {
  if (size > maxBytes) {
    throw new DataError(
      `The document with its proof has ${size} bytes as JSON, more than the option maxBytes allows, ${maxBytes}.`,
    );
  }
}

/**
 * Returns the document without its proof, as the cryptosuite signs and verifies it.
 *
 * @throws `DataError` when the document has no `@context`, which the JSON-LD processors need to read it.
 */
export function withoutProof(document: JsonObject): JsonObject {
  const { proof: _proof, ...unsecured } = document;
  if (unsecured["@context"] === undefined) {
    throw new DataError("The document has no @context, which the cryptosuite needs to read it as JSON-LD.");
  }
  return unsecured;
}
