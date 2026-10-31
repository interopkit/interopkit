/**
 * LTI 1.3 for learning platforms and tools: the error of the protocol, the request and answer as plain data, and the cache
 * of key sets. The tool role is in `@interopkit/tool-integration/tool`.
 *
 * @module @interopkit/tool-integration
 */
export { LtiError } from "./errors.js";
export type { HttpRequest, HttpResponse, JwksCache, JwksCacheOptions } from "./protocol/index.js";
export { createJwksCache } from "./protocol/index.js";
