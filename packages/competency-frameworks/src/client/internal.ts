/**
 * What the tests share of `client` and the package does not export: the readers of the paging headers and the writer of the
 * parameters of a request.
 *
 * @module
 */
export { hasNextLink, totalCountOf } from "./paging.js";
export { queryString } from "./query.js";
