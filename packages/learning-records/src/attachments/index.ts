/**
 * The attachments of a Statement: the hash that names their data, and the `multipart/mixed` message that carries them with the
 * Statements.
 *
 * @module
 */

export { hashAttachment } from "./hash-attachment.js";
export type { MultipartLimits } from "./limits.js";
export { type MultipartContent, readMultipart } from "./read-multipart.js";
export { type MultipartMessage, type MultipartStatements, writeMultipart } from "./write-multipart.js";
