/**
 * Returns a document with its `proof` as a list, as the model of a credential has it. The suites write the proof as the
 * compacted form of JSON-LD does when there is one, an object; a list of one proof means the same and is what a consumer of the
 * model reads.
 */
export function withProofList(document: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const { proof } = document;
  return proof === undefined || Array.isArray(proof) ? document : { ...document, proof: [proof] };
}

/**
 * Returns a document with its only proof as an object, as the processors of `ecdsa-sd-2023` read it: a list of one proof and the
 * proof itself mean the same. A document with more than one proof is returned as it is, for the processor to refuse.
 */
export function withProofObject(document: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const { proof } = document;
  return Array.isArray(proof) && proof.length === 1 ? { ...document, proof: proof[0] } : document;
}
