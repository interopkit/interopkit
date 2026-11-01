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
