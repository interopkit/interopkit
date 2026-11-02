/**
 * What the three roles of the suite share: the options of a call, the document as JSON, the JSON pointers, the loader of
 * contexts, and the labels of blank nodes.
 *
 * @module
 */
export { hmacLabelMap } from "./labels.js";
export { createProcessing, type Processing } from "./loader.js";
export { readCommonOptions } from "./options.js";
export { checkPointers } from "./pointers.js";
export {
  canonicalize,
  canonicalizeAndGroup,
  createLabelMapFunction,
  hashCanonizedProof,
  hashMandatory,
  labelReplacementCanonicalizeJsonLd,
  selectJsonLd,
  stripBlankNodePrefixes,
} from "./primitives.js";
export { checkSize, type JsonDocument, readJson, withoutProof } from "./read-document.js";
