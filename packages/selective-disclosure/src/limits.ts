/**
 * The most bytes of a document with its proof, as JSON, that a function reads unless the caller sets another limit:
 * 1 MiB. A base proof holds a 64-byte signature for every statement that can be hidden, so the proof grows with the document.
 */
export const DEFAULT_MAX_BYTES = 1_048_576;

/**
 * Bounds the work of RDF Dataset Canonicalization on blank-node graphs built to exhaust it: the `maxWorkFactor` of
 * `rdf-canonize`, which is 1 by default and which the primitives keep (RDF Dataset Canonicalization, section 4.8).
 */
export const MAX_WORK_FACTOR = 1;
