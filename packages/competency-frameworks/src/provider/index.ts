/**
 * The CASE provider: the REST binding as a handler over plain requests and a store of frameworks, the evaluator
 * of its query grammar, and the localization of its discovery file.
 *
 * @module @interopkit/competency-frameworks/provider
 */
export { type LocalizeOpenApiOptions, localizeOpenApi } from "./discovery.js";
export { handleCaseRequest } from "./handle-request.js";
export type { CaseProviderOptions } from "./options.js";
export type { ParsedCaseQuery } from "./parse-query.js";
export { queryEntities } from "./query-entities.js";
export type { DocumentPage, FrameworkStore } from "./store.js";
