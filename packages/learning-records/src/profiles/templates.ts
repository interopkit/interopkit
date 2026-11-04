import type { LanguageMap } from "../model/index.js";

/** What a rule asks of the values at its location: that there is one, that there is none, or neither unless there is one. */
export const RULE_PRESENCES = ["included", "excluded", "recommended"] as const;

/** The `presence` of a {@link StatementTemplateRule}. */
export type RulePresence = (typeof RULE_PRESENCES)[number];

/**
 * A rule of a Statement Template: a location in a Statement as JSONPath, and what the values found there must be.
 *
 * @remarks
 * A rule has at least one of `presence`, `any`, `all` and `none`. The JSONPath is Goessner's without filters and scripts, with
 * names, indexes, `*`, unions in brackets and `|` between paths.
 */
export interface StatementTemplateRule {
  /** The JSONPath that finds the values in a Statement. */
  readonly location: string;
  /** A JSONPath that finds the values within each value at `location`; a value where it finds none is unmatchable. */
  readonly selector?: string;
  /** Whether a value must be there, must not be there, or is recommended. */
  readonly presence?: RulePresence;
  /** Values of which the Statement has at least one. */
  readonly any?: readonly unknown[];
  /** The values that every value found must be one of. */
  readonly all?: readonly unknown[];
  /** Values that no value found may be. */
  readonly none?: readonly unknown[];
  /** How a Statement fills the location, by language. */
  readonly scopeNote?: LanguageMap;
}

/**
 * A Statement Template: one way that a Statement following the profile is formed.
 *
 * @remarks
 * The verb, the object activity type, the activity types of the context and the attachment usage types are the Determining
 * Properties: a Statement that has them all matches the template, and must then follow its rules.
 */
export interface StatementTemplate {
  /** The URI of the template, which changes when a Determining Property, a reference or a rule changes. */
  readonly id: string;
  /** `StatementTemplate`. */
  readonly type: "StatementTemplate";
  /** The IRI of the version of the profile that describes the template. */
  readonly inScheme: string;
  /** A descriptive name, by language. */
  readonly prefLabel: LanguageMap;
  /** The purpose and the use, by language. */
  readonly definition: LanguageMap;
  /** Whether the template is deprecated. */
  readonly deprecated?: boolean;
  /** The IRI of the verb. */
  readonly verb?: string;
  /** The activity type of the object. */
  readonly objectActivityType?: string;
  /** Activity types that the `grouping` context activities have. */
  readonly contextGroupingActivityType?: readonly string[];
  /** Activity types that the `parent` context activities have. */
  readonly contextParentActivityType?: readonly string[];
  /** Activity types that the `other` context activities have. */
  readonly contextOtherActivityType?: readonly string[];
  /** Activity types that the `category` context activities have. */
  readonly contextCategoryActivityType?: readonly string[];
  /** Usage types that the attachments have. */
  readonly attachmentUsageType?: readonly string[];
  /** Templates of this version, one of which the Statement that the object refers to matches. */
  readonly objectStatementRefTemplate?: readonly string[];
  /** Templates of this version, one of which the Statement that the context refers to matches. */
  readonly contextStatementRefTemplate?: readonly string[];
  /** The rules that a matching Statement follows. */
  readonly rules?: readonly StatementTemplateRule[];
}
