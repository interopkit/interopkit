/**
 * The client of an LRS: the seven resources of the standard over `fetch`, with the preconditions of its version, the pages of a
 * query, and the data of Attachments.
 *
 * @module @interopkit/learning-records/client
 */
export { createLrsClient, type LrsClient } from "./client.js";
export type { LrsClientOptions } from "./config.js";
export type { DeleteOptions, ListOptions, WriteOptions, WriteOutcome } from "./documents.js";
export type {
  GetStatementOptions,
  ReadStatementsOptions,
  SendOptions,
  StatementPage,
  StatementWithAttachments,
} from "./statements.js";
