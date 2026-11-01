import { DataError } from "@interopkit/core";
import {
  createLabelMapFunction,
  hashCanonizedProof,
  hashMandatory,
  type JsonDocument,
  labelReplacementCanonicalizeJsonLd,
  type Processing,
} from "../document/index.js";

/** What a verifier checks the signatures against. */
export interface VerifyData {
  /** The hash of the proof options. */
  readonly proofHash: Uint8Array;
  /** The hash of the mandatory statements. */
  readonly mandatoryHash: Uint8Array;
  /** The statements that are not mandatory, which the proof key signed one by one. */
  readonly nonMandatory: readonly string[];
}

/**
 * Splits the statements of the revealed document into the mandatory and the others, by the positions that the proof names.
 *
 * @throws `DataError` when a position is not in the document or the positions are not in ascending order. A proof made by the
 * algorithm of the Recommendation never has either.
 */
function splitStatements(
  statements: readonly string[],
  mandatoryIndexes: readonly number[],
): { readonly mandatory: string[]; readonly nonMandatory: string[] } {
  let previous = -1;
  for (const index of mandatoryIndexes) {
    if (index <= previous || index >= statements.length) {
      throw new DataError(
        "The mandatoryIndexes of the proof must be in ascending order and each must be the position of a statement of the document.",
      );
    }
    previous = index;
  }
  const mandatoryPositions = new Set(mandatoryIndexes);
  const mandatory: string[] = [];
  const nonMandatory: string[] = [];
  for (const [index, statement] of statements.entries()) {
    (mandatoryPositions.has(index) ? mandatory : nonMandatory).push(statement);
  }
  return { mandatory, nonMandatory };
}

/**
 * Creates the data to verify a derived proof (Data Integrity ECDSA Cryptosuites, section 3.5.9).
 *
 * @param document - The revealed document without its proof.
 * @param proofOptions - The proof without its `proofValue`.
 * @param labelMap - The label map of the proof.
 * @param mandatoryIndexes - The positions of the mandatory statements, from the proof.
 * @param processing - The options of the JSON-LD processors.
 */
export async function createVerifyData(
  document: JsonDocument,
  proofOptions: JsonDocument,
  labelMap: ReadonlyMap<string, string>,
  mandatoryIndexes: readonly number[],
  processing: Processing,
): Promise<VerifyData> {
  const [proofHash, statements] = await Promise.all([
    hashCanonizedProof({ document, proof: proofOptions, options: processing.options }),
    labelReplacementCanonicalizeJsonLd({
      document,
      labelMapFactoryFunction: createLabelMapFunction({ labelMap }),
      options: processing.options,
    }),
  ]);
  const { mandatory, nonMandatory } = splitStatements(statements, mandatoryIndexes);
  const { mandatoryHash } = await hashMandatory({ mandatory });
  return { proofHash, mandatoryHash, nonMandatory };
}
