/** The versions of CASE that this package reads and writes: the CASE Service 1.0 of 2017 and the CASE Service 1.1 of 2024. */
export const CASE_VERSIONS = ["1.0", "1.1"] as const;

/**
 * A version of CASE that this package reads and writes.
 *
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1}
 */
export type CaseVersion = (typeof CASE_VERSIONS)[number];

/**
 * The association types that CASE 1.1 defines (Information Model 7.4.1).
 *
 * @remarks
 * `isTranslationOf` is new in 1.1. A provider may extend the vocabulary with terms that start with `ext:`, which the type
 * `ExtensionTerm` names.
 */
export const ASSOCIATION_TYPES = [
  "isChildOf",
  "isPeerOf",
  "isPartOf",
  "exactMatchOf",
  "precedes",
  "isRelatedTo",
  "replacedBy",
  "exemplar",
  "hasSkillLevel",
  "isTranslationOf",
] as const;

/** A term of the association vocabulary of CASE 1.1 that the specification defines. */
export type AssociationType = (typeof ASSOCIATION_TYPES)[number];

/**
 * A term that a provider adds to an extensible vocabulary: `ext:` and a name of letters, digits, `.`, `-` and `_`
 * (Information Model 7.2.1).
 */
export type ExtensionTerm = `ext:${string}`;

/** The kind of what an association links to. `CASE` is a CASE framework or a node of one; another kind is an `ext:` term. */
export type TargetType = "CASE" | ExtensionTerm;
