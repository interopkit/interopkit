import type { LanguageMap } from "../model/index.js";

/** The properties of a Pattern that order its members: a Pattern has exactly one of them. */
export const PATTERN_KINDS = ["alternates", "optional", "oneOrMore", "sequence", "zeroOrMore"] as const;

/** One of {@link PATTERN_KINDS}. */
export type PatternKind = (typeof PATTERN_KINDS)[number];

/**
 * A Pattern: how Statements that match Statement Templates follow one another in a registration.
 *
 * @remarks
 * A Pattern has exactly one of `alternates`, `optional`, `oneOrMore`, `sequence` and `zeroOrMore`, whose members are the IRIs
 * of Patterns and Statement Templates, of this profile or of others. Only a primary Pattern is matched against the Statements
 * of a registration; it has `prefLabel` and `definition`.
 */
export interface Pattern {
  /** The URI of the Pattern, which changes when its members change. */
  readonly id: string;
  /** `Pattern`. */
  readonly type: "Pattern";
  /** Whether the Statements of a registration are matched against it. */
  readonly primary?: boolean;
  /** The IRI of the version of the profile that describes the Pattern. */
  readonly inScheme?: string;
  /** A descriptive name, by language. */
  readonly prefLabel?: LanguageMap;
  /** The purpose and the use, by language. */
  readonly definition?: LanguageMap;
  /** Whether the Pattern is deprecated. */
  readonly deprecated?: boolean;
  /** Members of which one matches. */
  readonly alternates?: readonly string[];
  /** A member that matches once, or is absent. */
  readonly optional?: string;
  /** A member that matches once or more. */
  readonly oneOrMore?: string;
  /** Members that match in this order. */
  readonly sequence?: readonly string[];
  /** A member that is absent, or matches once or more. */
  readonly zeroOrMore?: string;
}
