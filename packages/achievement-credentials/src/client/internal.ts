/**
 * What the tests share of `client` and the package does not export: the readers of the paging headers and the wrapper of the
 * readers of an answer.
 *
 * @module
 */
export { readAnswer } from "./client.js";
export { hasNextLink, totalCountOf } from "./paging.js";
