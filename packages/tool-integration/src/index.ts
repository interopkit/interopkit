/**
 * LTI 1.3 for learning platforms and tools: the error of the protocol and the cache of key sets. The requests and answers
 * that its handlers take and return are in `@interopkit/core/http`. The tool role is in `@interopkit/tool-integration/tool`.
 *
 * @module @interopkit/tool-integration
 */
export { LtiError } from "./errors.js";
export type { JwksCache, JwksCacheOptions } from "./protocol/index.js";
export { createJwksCache } from "./protocol/index.js";
