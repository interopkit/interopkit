/**
 * The client of a CASE provider: the twelve endpoints of the REST binding with their set types, paging of the document
 * list, the filter of a request, the OpenAPI file of service discovery, and the status that a provider answers an error with.
 *
 * @module @interopkit/competency-frameworks/client
 */
export { type CaseClient, createCaseClient, type SelectedDocument } from "./client.js";
export type { CaseClientOptions } from "./config.js";
export { writeCaseFilter } from "./query.js";
