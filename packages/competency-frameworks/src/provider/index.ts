/**
 * The CASE provider: the REST binding as a handler over plain requests and a store of frameworks, the parser and the
 * evaluator of its query grammar, and the localization of its discovery file.
 *
 * @module
 */
export { type LocalizeOpenApiOptions, localizeOpenApi } from "./discovery.js";
export { handleCaseRequest } from "./handle-request.js";
export type { CaseProviderOptions } from "./options.js";
export { type ParsedCaseQuery, parseCaseQuery, type QueryRefusal } from "./parse-query.js";
export { type QueryEntitiesOptions, queryEntities } from "./query-entities.js";
export type { DocumentPage, FrameworkStore } from "./store.js";
