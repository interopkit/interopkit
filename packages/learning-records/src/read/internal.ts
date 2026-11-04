/**
 * What the other modules and the tests share of `read` and the package does not export.
 *
 * @module
 */
export { scopeSchema, stateScopeSchema, targetSchema } from "./document-target.js";
export { error, warning } from "./finding.js";
export { authoritySchema, identifiedAgentSchema } from "./identified.js";
export { inspectStatement } from "./inspect.js";
export { item, member } from "./path.js";
export { singleActivityIssues } from "./provider.js";
export { inspectBatch, readEitherVersion } from "./read-statement.js";
export { patternProblem } from "./response-pattern.js";
export {
  aboutSchema,
  activitySchema,
  actorSchema,
  attachmentDataSchema,
  bytesSchema,
  languageMapSchema,
  languageRangesSchema,
  mediaTypeSchema,
  personSchema,
  STATEMENT_SCHEMAS,
} from "./schemas.js";
export { statementQuerySchema } from "./statement-query.js";
export { attachmentHeadersOf, walkStatement } from "./walk.js";
