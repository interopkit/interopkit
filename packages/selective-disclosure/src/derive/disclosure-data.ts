import { DataError } from "@interopkit/core";
import {
  canonicalize,
  canonicalizeAndGroup,
  hmacLabelMap,
  type JsonDocument,
  type Processing,
  selectJsonLd,
  stripBlankNodePrefixes,
} from "../document/index.js";
import type { BaseProofValue, DerivedProofValue } from "../proof-value/index.js";

/** What a derived proof is made of, and the part of the document it reveals. */
export interface DisclosureData extends DerivedProofValue {
  /** The document with only the mandatory and the selected parts. */
  readonly revealDocument: JsonDocument;
}

/**
 * Works out what to reveal (Data Integrity ECDSA Cryptosuites, section 3.5.4).
 *
 * @param document - The document without its proof.
 * @param base - The parsed base proof value.
 * @param selectivePointers - What the holder chooses to reveal besides the mandatory parts. Together with the mandatory
 * pointers of the base proof, there is at least one.
 * @param processing - The options of the JSON-LD processors.
 * @throws `DataError` when the base proof does not belong to the document: its signatures are not one for each statement that
 * is not mandatory.
 */
export async function createDisclosureData(
  document: JsonDocument,
  base: BaseProofValue,
  selectivePointers: readonly string[],
  processing: Processing,
): Promise<DisclosureData> {
  const { baseSignature, publicKey, hmacKey, signatures, mandatoryPointers } = base;
  const combinedPointers = [...mandatoryPointers, ...selectivePointers];
  const {
    groups: { mandatory, selective, combined },
    labelMap,
  } = await canonicalizeAndGroup({
    document,
    labelMapFactoryFunction: await hmacLabelMap(hmacKey),
    groups: { mandatory: mandatoryPointers, selective: selectivePointers, combined: combinedPointers },
    options: processing.options,
  });

  if (signatures.length !== mandatory.nonMatching.size) {
    throw new DataError(
      `The base proof has ${signatures.length} signatures and the document has ${mandatory.nonMatching.size} statements that are not mandatory: the proof does not belong to this document.`,
    );
  }

  // The positions of the mandatory statements among the statements that are revealed, as the verifier counts them.
  const mandatoryIndexes: number[] = [];
  let relative = 0;
  for (const absolute of combined.matching.keys()) {
    if (mandatory.matching.has(absolute)) mandatoryIndexes.push(relative);
    relative += 1;
  }

  // The base proof signs the statements that are not mandatory in order: keep those that the holder reveals by choice.
  let position = 0;
  const revealedSignatures = signatures.filter(() => {
    while (mandatory.matching.has(position)) position += 1;
    const revealed = selective.matching.has(position);
    position += 1;
    return revealed;
  });

  // The labels that a verifier finds for the blank nodes of the revealed document, mapped to the labels that were signed.
  const canonicalIdMap = new Map<string, string>();
  await canonicalize(combined.deskolemizedNQuads.join(""), {
    ...processing.options,
    inputFormat: "application/n-quads",
    canonicalIdMap,
  });
  const verifierLabels = stripBlankNodePrefixes(canonicalIdMap);
  const verifierLabelMap = new Map<string, string>();
  for (const [inputLabel, signedLabel] of labelMap) {
    const verifierLabel = verifierLabels.get(inputLabel);
    if (verifierLabel !== undefined) verifierLabelMap.set(verifierLabel, signedLabel);
  }

  return {
    baseSignature,
    publicKey,
    signatures: revealedSignatures,
    labelMap: verifierLabelMap,
    mandatoryIndexes,
    revealDocument: selectJsonLd({ document, pointers: combinedPointers }),
  };
}
