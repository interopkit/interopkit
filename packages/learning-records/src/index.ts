/**
 * xAPI 2.0 and 1.0.3 learning records: the model of a Statement, readers and validators for the rules of an LRS and of a
 * Learning Record Provider in either version, the text of a request read without a repeated property, builders of Statements,
 * their comparison and formats, and the form of a Statement in 1.0.3.
 *
 * It also exports the types of `@interopkit/core` that its declarations name, which a program that installs this
 * package imports from here.
 *
 * @module @interopkit/learning-records
 */

export type { CallOptions, Clock, Fetch, Signer } from "@interopkit/core";
export type { Issue, JsonObject } from "@interopkit/core/checks";
export type { AccessDecision, HttpRequest, HttpResponse } from "@interopkit/core/http";
export {
  type BuildOptions,
  buildStatement,
  buildVoidingStatement,
  deriveStatementId,
  mboxSha1sum,
  type StatementInput,
  type VoidingInput,
} from "./build/index.js";
export { convertStatementVersion, isSameActor, isSameStatement } from "./compare/index.js";
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
  findStatementTime,
  formatDuration,
  type Group,
  INTERACTION_TYPES,
  type InteractionComponent,
  type InteractionType,
  type InverseFunctionalIdentifiers,
  isDuration,
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
  type ParseStatementJsonOptions,
  parseStatementJson,
  type ReadOptions,
  readStatement,
  validateStatement,
  validateStatements,
} from "./read/index.js";
