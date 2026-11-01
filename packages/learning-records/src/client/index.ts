/**
 * The client of an LRS: the seven resources of the standard over `fetch`, with the preconditions of its version, the pages of a
 * query, and the data of Attachments.
 *
 * @module @interopkit/learning-records/client
 */
export { createLrsClient, type LrsClient } from "./client.js";
export type { LrsClientConfig } from "./config.js";
export type { DeleteOptions, ListOptions, WriteOptions, WriteOutcome } from "./documents.js";
export type { GetStatementOptions, SendOptions, StatementPage } from "./statements.js";
