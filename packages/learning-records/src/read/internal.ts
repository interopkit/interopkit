/**
 * What the other modules and the tests share of `read` and the package does not export.
 *
 * @module
 */
export { authoritySchema, identifiedAgentSchema } from "./identified.js";
export { inspectStatement, issueSink } from "./inspect.js";
export { singleActivityIssues } from "./provider.js";
export { patternProblem } from "./response-pattern.js";
export {
  aboutSchema,
  activitySchema,
  attachmentDataSchema,
  personSchema,
} from "./schemas.js";
export { statementQuerySchema } from "./statement-query.js";
