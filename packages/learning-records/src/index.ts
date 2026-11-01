/**
 * xAPI 2.0 learning records: the model of a Statement, readers and validators for the rules of an LRS and of a Learning Record
 * Provider, and the text of a request read without a repeated property.
 *
 * @module @interopkit/learning-records
 */
export {
  type Account,
  type Activity,
  type ActivityDefinition,
  type Actor,
  type Agent,
  type AgentObject,
  type Attachment,
  CONTEXT_ACTIVITY_TYPES,
  type Context,
  type ContextActivities,
  type ContextActivityType,
  type ContextAgent,
  type ContextGroup,
  type Extensions,
  type Group,
  INTERACTION_TYPES,
  type InteractionComponent,
  type InteractionType,
  type InverseFunctionalIdentifiers,
  type LanguageMap,
  type Result,
  RULE_ROLES,
  type RuleRole,
  type Score,
  type Statement,
  type StatementIssue,
  type StatementObject,
  type StatementProperties,
  type StatementRef,
  type SubStatement,
  type SubStatementObject,
  VERB_VOIDED,
  type Verb,
} from "./model/index.js";
export {
  type ReadOptions,
  type ReadStatementJsonOptions,
  readStatement,
  readStatementJson,
  validateStatement,
  validateStatements,
} from "./read/index.js";
