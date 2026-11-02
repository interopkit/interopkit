import jsonld from "@interop/jsonld";

/**
 * The most times that RDF Dataset Canonicalization runs its Hash N-Degree Quads algorithm on one credential: the
 * `maxDeepIterations` of `rdf-canonize` (RDF Dataset Canonicalization, section 4.8). The default of `rdf-canonize` allows a run
 * for each blank node that looks like another, and each run copies the labels issued on its path, so a list of alike items
 * takes memory with the square of its length: a list of 5,000 items takes a second and 900 MiB. A fixed count bounds both
 * (`selective-disclosure` uses the same), and the examples of Open Badges 3.0 and CLR 2.0 need at most 16 runs.
 */
export const MAX_DEEP_ITERATIONS = 1_000;

/** The canonical form of a document by the digest that its blank nodes are hashed with: the same document is canonized once. */
const known = new WeakMap<object, Map<string, Promise<string>>>();

/** Canonizes a document once, with no memory of what it did before. */
async function canonize(input: object, options: Readonly<Record<string, unknown>>): Promise<string> {
  const { messageDigestAlgorithm, ...processing } = options;
  return await jsonld.canonize(input, {
    base: null,
    safe: true,
    ...processing,
    rdfDirection: "i18n-datatype",
    canonizeOptions: {
      algorithm: "RDFC-1.0",
      format: "application/n-quads",
      maxDeepIterations: MAX_DEEP_ITERATIONS,
      ...(messageDigestAlgorithm === undefined ? {} : { messageDigestAlgorithm }),
    },
  });
}

/**
 * Canonizes a JSON-LD document as the adopted cryptosuites do (RDFC-1.0, N-Quads, safe mode, `@direction` as datatypes), and
 * stops after `MAX_DEEP_ITERATIONS` runs of the Hash N-Degree Quads algorithm. The cryptosuites of the library pass no bound
 * of their own, so this takes the place of their `canonize`.
 *
 * @remarks
 * The same object, given again with the same digest, is not canonized again: a credential with several proofs costs one
 * canonicalization of the credential and one of each proof's options. The glue never changes an object that it gives, and a
 * failure is not kept.
 *
 * @param input - The document.
 * @param options - The options of the cryptosuite: the loader of documents, and the digest that the hash of a blank node uses.
 * @returns The canonical form, as N-Quads.
 * @throws The error of the processor when the document is refused, a context cannot be loaded or the bound is reached.
 */
export function boundedCanonize(input: object, options: Readonly<Record<string, unknown>> = {}): Promise<string> {
  const digest = typeof options.messageDigestAlgorithm === "string" ? options.messageDigestAlgorithm : "";
  const byDigest = known.get(input) ?? new Map<string, Promise<string>>();
  known.set(input, byDigest);
  const earlier = byDigest.get(digest);
  if (earlier !== undefined) return earlier;
  const canonical = canonize(input, options);
  byDigest.set(digest, canonical);
  canonical.catch(() => byDigest.delete(digest));
  return canonical;
}
