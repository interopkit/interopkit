/**
 * The most bytes of a document with its proof, as JSON, that a function reads unless the caller sets another limit:
 * 1 MiB. A base proof holds a 64-byte signature for every statement that can be hidden, so the proof grows with the document.
 */
export const DEFAULT_MAX_BYTES = 1_048_576;

/**
 * The most tokens of JSON of a document with its proof that a function reads unless the caller sets another limit. The
 * JSON-LD processor adds each value of a property after a search of the values that the property already holds, so its work
 * grows with the square of the values of one property: 1 MiB of short values in one array takes minutes, and 20,000 tokens
 * take under a second. The largest example of Open Badges 3.0 has 2,053 tokens.
 */
export const DEFAULT_MAX_TOKENS = 20_000;

/**
 * The most times that RDF Dataset Canonicalization runs its Hash N-Degree Quads algorithm on one document: the
 * `maxDeepIterations` of `rdf-canonize` (RDF Dataset Canonicalization, section 4.8). The default of `rdf-canonize` allows a
 * run for each blank node that looks like another, and each run copies the labels issued on its path, so a list of alike
 * items takes memory with the square of its length: a list of 20,000 tokens fills 2 GB. A fixed count bounds both, and the
 * examples of Open Badges 3.0 and CLR 2.0 need at most 16 runs.
 */
export const MAX_DEEP_ITERATIONS = 1_000;
