/**
 * Requests and answers as plain data, and the helpers that handlers share: reading the text, JSON, query and form of a
 * request, building a JSON answer, and choosing a media type from `Accept`. A host builds an `HttpRequest` from the request
 * type of its framework and sends the `HttpResponse` that a handler returns.
 *
 * @module @interopkit/core/http
 */
export { type ReadJsonOptions, readJson, readText } from "./body.js";
export { negotiate } from "./negotiate.js";
export { readForm, readQuery } from "./parameters.js";
export { checkHttpRequest, type HttpRequest } from "./request.js";
export { type HttpResponse, jsonResponse } from "./response.js";
