/**
 * The handler of an LRS over plain requests and the ports of its storage: routing, versions, parameters, status codes,
 * voiding, the filters of a query, and Attachments.
 *
 * @module @interopkit/learning-records/store
 */

export { type BasicCredentials, readBasicAuthorization } from "./basic.js";
export type { LrsLimits, LrsOptions } from "./options.js";
export {
  type Access,
  type ActivityStore,
  type AgentStore,
  type DocumentStore,
  type InsertResult,
  LRS_ACTIONS,
  type LrsAction,
  type LrsGrant,
  type StatementStore,
  type StatementsPage,
  type StoredStatement,
  type WriteCondition,
} from "./ports.js";
export { type MatchOptions, matchesStatementQuery } from "./query.js";
export { handleLrsRequest } from "./router.js";
