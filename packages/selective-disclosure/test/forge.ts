import { createLabelMapFunction, labelReplacementCanonicalizeJsonLd } from "../src/document/internal.js";
import {
  type DerivedProofValue,
  parseDerivedProofValue,
  serializeDerivedProofValue,
} from "../src/proof-value/index.js";
import { memoryContexts } from "./contexts.js";
import type { Disclosure } from "./setup.js";

/** The derived proof of a disclosure with its components changed, as someone who holds the disclosure could write it. */
export function proofWith(
  { proof }: Disclosure,
  change: (components: DerivedProofValue) => DerivedProofValue,
): Record<string, unknown> {
  return { ...proof, proofValue: serializeDerivedProofValue(change(parseDerivedProofValue(proof.proofValue))) };
}

/** The canonical statements of a revealed document, as a verifier reads them with the label map of the proof. */
export async function statementsOf(document: Readonly<Record<string, unknown>>, labelMap: ReadonlyMap<string, string>) {
  const contexts = memoryContexts();
  return labelReplacementCanonicalizeJsonLd({
    document,
    labelMapFactoryFunction: createLabelMapFunction({ labelMap }),
    options: {
      documentLoader: async (url: string) => ({
        contextUrl: null,
        documentUrl: url,
        document: await contexts.load(url),
      }),
      maxDeepIterations: 1000,
    },
  });
}

/** Every order of a list, which is how many ways there are to give labels to a few blank nodes. */
function orders<TItem>(items: readonly TItem[]): TItem[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    orders([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

/**
 * What someone who holds a disclosure needs to forge a disclosure of another document with the same mandatory statements: a
 * label map and the positions of the mandatory statements that make the changed document show exactly the mandatory
 * statements of the honest one. The labels are the ones the honest disclosure has, in the order that fits, as the HMAC key is
 * not needed to reuse them.
 */
export async function forgedLabels(forged: Readonly<Record<string, unknown>>, honest: Disclosure) {
  const { labelMap, mandatoryIndexes } = parseDerivedProofValue(honest.proof.proofValue);
  const statements = await statementsOf(honest.document, labelMap);
  const mandatory = new Set(mandatoryIndexes.map((index) => statements[index]));
  const keys = [...labelMap.keys()].sort();
  for (const labels of orders([...labelMap.values()])) {
    const attempt = new Map(keys.map((key, index) => [key, labels[index] ?? ""]));
    const changed = await statementsOf(forged, attempt);
    const positions = changed.flatMap((statement, index) => (mandatory.has(statement) ? [index] : []));
    if (positions.length === mandatoryIndexes.length)
      return { labelMap: attempt, statements: changed, mandatoryIndexes: positions };
  }
  throw new Error("The tests found no labels that keep the mandatory statements.");
}
