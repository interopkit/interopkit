/**
 * xAPI 2.0 learning records: the model of a Statement, readers and validators for the rules of an LRS and of a Learning Record
 * Provider, the text of a request read without a repeated property, builders of Statements, and their comparison and formats.
 *
 * @module @interopkit/learning-records
 */

export {
  buildStatement,
  deriveStatementId,
  mboxSha1sum,
  type StatementInput,
  type VoidingInput,
  voidingStatement,
} from "./build/index.js";
export { sameStatement } from "./compare/index.js";
export { type FormatOptions, formatStatement } from "./format/index.js";
export {
  type About,
  type Account,
  type Activity,
  type ActivityDefinition,
  type Actor,
  type Agent,
  type AgentObject,
  type Attachment,
  type AttachmentData,
  CONTEXT_ACTIVITY_TYPES,
  type Context,
  type ContextActivities,
  type ContextActivityType,
  type ContextAgent,
  type ContextGroup,
  type DocumentScope,
  type DocumentTarget,
  type Duration,
  type Extensions,
  formatDuration,
  formatTimestamp,
  type Group,
  INTERACTION_TYPES,
  type InteractionComponent,
  type InteractionType,
  type InverseFunctionalIdentifiers,
  type LanguageMap,
  type LrsDocument,
  type LrsDocumentInput,
  type Person,
  type Precondition,
  parseDuration,
  type Result,
  RULE_ROLES,
  type RuleRole,
  type Score,
  STATEMENT_FORMATS,
  type Statement,
  type StatementFormat,
  type StatementIssue,
  type StatementObject,
  type StatementProperties,
  type StatementQuery,
  type StatementRef,
  type StatementResult,
  type StateScope,
  type SubStatement,
  type SubStatementObject,
  VERB_VOIDED,
  type Verb,
  XAPI_VERSIONS,
  type XapiVersion,
} from "./model/index.js";
export {
  type ReadOptions,
  type ReadStatementJsonOptions,
  readStatement,
  readStatementJson,
  validateStatement,
  validateStatements,
} from "./read/index.js";
