/**
 * What the two roles of LTI share and the host also uses: the request and the answer as plain data, and the cache of the
 * key sets of platforms.
 *
 * @module
 */
export type { HttpRequest, HttpResponse } from "./http.js";
export { createJwksCache, type JwksCache, type JwksCacheOptions } from "./jwks.js";
