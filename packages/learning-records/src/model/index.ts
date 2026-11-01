/**
 * The model of xAPI 2.0: a Statement and the objects it holds, the vocabularies, and the findings of the readers.
 *
 * @module
 */
export type { Activity, ActivityDefinition, InteractionComponent } from "./activity.js";
export type { Account, Actor, Agent, AgentObject, Group, InverseFunctionalIdentifiers } from "./actor.js";
export type { Attachment, AttachmentData } from "./attachment.js";
export type { Context, ContextActivities, ContextAgent, ContextGroup } from "./context.js";
export { type Duration, formatDuration, parseDuration } from "./duration.js";
export type { StatementIssue } from "./issue.js";
export type { Extensions } from "./json.js";
export type { LanguageMap } from "./language-map.js";
export type { Result, Score } from "./result.js";
export type {
  Statement,
  StatementObject,
  StatementProperties,
  StatementRef,
  StatementResult,
  SubStatement,
  SubStatementObject,
  Verb,
} from "./statement.js";
export {
  CONTEXT_ACTIVITY_TYPES,
  type ContextActivityType,
  INTERACTION_TYPES,
  type InteractionType,
  RULE_ROLES,
  type RuleRole,
  VERB_VOIDED,
} from "./terms.js";
export { formatTimestamp } from "./timestamp.js";
