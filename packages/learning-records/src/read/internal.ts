/**
 * What the other modules and the tests share of `read` and the package does not export.
 *
 * @module
 */
export { scopeSchema, stateScopeSchema, targetSchema } from "./document-target.js";
export { authoritySchema, identifiedAgentSchema } from "./identified.js";
export { inspectStatement, issueSink } from "./inspect.js";
export { singleActivityIssues } from "./provider.js";
export { inspectBatch, readEitherVersion } from "./read-statement.js";
export { patternProblem } from "./response-pattern.js";
export {
  aboutSchema,
  activitySchema,
  attachmentDataSchema,
  bytesSchema,
  languageRangesSchema,
  mediaTypeSchema,
  personSchema,
  STATEMENT_SCHEMAS,
} from "./schemas.js";
export { statementQuerySchema } from "./statement-query.js";
export { attachmentHeadersOf } from "./walk.js";
