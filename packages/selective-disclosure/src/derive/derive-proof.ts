import { type CallOptions, DataError } from "@interopkit/core";
import { checkRecord, describe, isRecord } from "@interopkit/core/checks";
import {
  checkPointers,
  checkSize,
  createProcessing,
  type JsonDocument,
  jsonBytes,
  readCommonOptions,
  readJson,
  withoutProof,
} from "../document/index.js";
import { isBaseProof, parseBaseProofValue, serializeDerivedProofValue } from "../proof-value/index.js";
import { CRYPTOSUITE } from "../suite.js";
import { createDisclosureData } from "./disclosure-data.js";

/** The options of `deriveProof`. */
export interface DeriveProofOptions extends CallOptions {
  /** The JSON pointers to what to reveal besides the mandatory parts of the base proof. */
  readonly selectivePointers: readonly string[];
  /** Returns the JSON-LD context behind a URL. The processors read no context from anywhere else. */
  readonly contexts: (url: string, options?: CallOptions) => Promise<unknown>;
  /**
   * The most bytes of the document with its base proof as JSON.
   *
   * @defaultValue 1,048,576
   */
  readonly maxBytes?: number;
}

/**
 * Derives a proof that reveals part of a document: the holder's step from a base proof to the proof that goes to a verifier.
 *
 * @remarks
 * The result holds what the mandatory pointers of the base proof and the selective pointers select, and a derived proof
 * without the HMAC key and with only the signatures of the statements that stay. The labels of the blank nodes come from the
 * HMAC key of the base proof, so two disclosures of one credential carry the same labels, the same public key of the proof and
 * the same signature of the issuer: a verifier, or two, can link them. The guide says so.
 *
 * @param document - The document with a base proof as its `proof`. It is not changed.
 * @param options - The pointers to reveal and the loader of contexts.
 * @returns A new document with the selected parts and a derived proof.
 * @throws `DataError` when an argument is not valid, the proof is not a base proof of `ecdsa-sd-2023`, nothing is selected,
 * a pointer points at nothing in the document, the proof does not belong to the document, or the JSON-LD processors refuse
 * the document or its contexts.
 * @throws The error of the context loader when it fails, and the `reason` of the signal when it aborts.
 * @see {@link https://www.w3.org/TR/vc-di-ecdsa/#add-derived-proof-ecdsa-sd-2023 | Add Derived Proof (ecdsa-sd-2023)}
 */
export async function deriveProof(document: JsonDocument, options: DeriveProofOptions): Promise<JsonDocument> {
  const { contexts, signal, maxBytes } = readCommonOptions(options, "The options of deriveProof");
  checkRecord(document, "The document must be an object");
  const copy = readJson(document, "The document");
  checkSize(jsonBytes(copy), maxBytes);
  const { proof } = copy;
  if (!isRecord(proof)) {
    throw new DataError(`The document must have one proof, as an object, found ${describe(proof)}.`);
  }
  if (!isBaseProof(proof)) {
    throw new DataError(
      `The proof must be a base proof of ${CRYPTOSUITE}: its cryptosuite is ${describe(proof.cryptosuite)} and its proofValue is not the value of a base proof. A derived proof cannot be derived again.`,
    );
  }
  const base = parseBaseProofValue(proof.proofValue);
  const unsecured = withoutProof(copy);
  const selectivePointers = checkPointers(options.selectivePointers, "The option selectivePointers", unsecured);
  const mandatoryPointers = checkPointers(base.mandatoryPointers, "The mandatoryPointers of the base proof", unsecured);
  if (selectivePointers.length + mandatoryPointers.length === 0) {
    throw new DataError(
      "Nothing is selected to reveal: the base proof has no mandatory pointers and the option selectivePointers is empty.",
    );
  }
  signal?.throwIfAborted();

  const processing = createProcessing(contexts, signal);
  const { revealDocument, ...derived } = await processing.wait(
    createDisclosureData(unsecured, base, selectivePointers, processing),
  );
  // The context of a proof is the one of its document, so a proof that carries its own context does not keep it.
  const { "@context": _context, ...proofOptions } = proof;
  return { ...revealDocument, proof: { ...proofOptions, proofValue: serializeDerivedProofValue(derived) } };
}
