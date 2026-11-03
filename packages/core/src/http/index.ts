/**
 * Requests and answers as plain data, and the helpers that handlers share: the path that a handler is mounted at, reading the
 * text, JSON, query, form and bearer token of a request, building a JSON answer, and choosing a media type from `Accept`; the paging of a list by `limit` and `offset`, the
 * `imsx_StatusInfo` of a failure of a service of 1EdTech, and the decision of a host about a request. A host builds an
 * `HttpRequest` from the request type of its framework and sends the `HttpResponse` that a handler returns.
 *
 * @module @interopkit/core/http
 */
export {
  type AccessDecision,
  type AccessRefusal,
  type ReadAccessDecisionOptions,
  readAccessDecision,
} from "./access.js";
export { basePathSchema } from "./base-path.js";
export { readBearerToken } from "./bearer.js";
export { type ReadJsonOptions, readJson, readText } from "./body.js";
export { negotiate } from "./negotiate.js";
export { buildPageLinks, type ListExtent, type OffsetPage, type PageSizes, readOffsetPage } from "./paging.js";
export { type ReadFormOptions, readForm, readQuery } from "./parameters.js";
export { checkHttpRequest, type HttpRequest } from "./request.js";
export { buildJsonResponse, type HttpResponse } from "./response.js";
export { buildStatusInfoResponse, type StatusInfoOptions } from "./status-info.js";
