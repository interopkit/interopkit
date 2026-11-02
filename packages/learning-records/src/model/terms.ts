/**
 * The IRI of the reserved Verb that voids a Statement (4.2.5): its Object is a Statement Reference to the Statement that it
 * voids.
 */
export const VERB_VOIDED = "http://adlnet.gov/expapi/verbs/voided";

/** The types of interaction that an Activity Definition may have (4.2.2.3). */
export const INTERACTION_TYPES = [
  "true-false",
  "choice",
  "fill-in",
  "long-fill-in",
  "matching",
  "performance",
  "sequencing",
  "likert",
  "numeric",
  "other",
] as const;

/** The type of an interaction (4.2.2.3). */
export type InteractionType = (typeof INTERACTION_TYPES)[number];

/** The keys that a `contextActivities` object may have (4.2.2.5): how an Activity relates to the Statement. */
export const CONTEXT_ACTIVITY_TYPES = ["parent", "grouping", "category", "other"] as const;

/** A key of `contextActivities` (4.2.2.5). */
export type ContextActivityType = (typeof CONTEXT_ACTIVITY_TYPES)[number];

/**
 * The roles whose rules the readers apply: the rules of an LRS, which lists what it shall reject (4.2), and the rules of a
 * Learning Record Provider, which lists what it shall and should do (5.2).
 */
export const RULE_ROLES = ["lrs", "provider"] as const;

/** The role whose rules a reader applies. */
export type RuleRole = (typeof RULE_ROLES)[number];

/**
 * The versions of xAPI that the package speaks, the latest first, as the `X-Experience-API-Version` header writes them (4.1.7):
 * each has its rules for Statements, its header in the client, and its route in the LRS.
 */
export const XAPI_VERSIONS = ["2.0.0", "1.0.3"] as const;

/** A version of xAPI. */
export type XapiVersion = (typeof XAPI_VERSIONS)[number];

/**
 * The `version` that a Statement of each version of xAPI carries when it carries its own: 2.0.0, and 1.0.0, which every Statement
 * of 1.0.x conforms to (4.2.4.3, 5.2.4.1; 1.0.3 Data 2.4.10).
 */
export const STATEMENT_VERSIONS: Readonly<Record<XapiVersion, string>> = { "2.0.0": "2.0.0", "1.0.3": "1.0.0" };

/**
 * The versions that belong to each version of xAPI, in a header or a Statement: 2.0 and 2.0.x (4.1.7), and 1.0 and 1.0.x (1.0.3
 * Communication 3.3, Data 2.4.10).
 */
export const VERSION_PATTERNS: Readonly<Record<XapiVersion, RegExp>> = {
  "2.0.0": /^2\.0(?:\.\d+)?$/u,
  "1.0.3": /^1\.0(?:\.\d+)?$/u,
};

/** The lists of components of an interaction, in the order of the table (4.2.2.3). */
export const COMPONENT_LISTS = ["choices", "scale", "source", "target", "steps"] as const;

/** A list of components of an interaction. */
export type ComponentList = (typeof COMPONENT_LISTS)[number];

/** The formats of the Statements that an LRS returns (4.1.6.1). */
export const STATEMENT_FORMATS = ["ids", "exact", "canonical"] as const;

/** A format of the Statements that an LRS returns: `ids`, `exact` or `canonical`. */
export type StatementFormat = (typeof STATEMENT_FORMATS)[number];
