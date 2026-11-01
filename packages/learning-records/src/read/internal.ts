/**
 * What the other modules and the tests share of `read` and the package does not export.
 *
 * @module
 */
export { inspectStatement, issueSink } from "./inspect.js";
export { singleActivityIssues } from "./provider.js";
export { patternProblem } from "./response-pattern.js";
export {
  aboutSchema,
  activitySchema,
  actorSchema,
  agentSchema,
  attachmentDataSchema,
  personSchema,
} from "./schemas.js";
