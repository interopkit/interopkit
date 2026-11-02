/**
 * The bodies of Context Groups: the groups and group sets of a context, and the filters of their request.
 *
 * @module
 */
export type { Group, GroupContainer, GroupQuery, GroupSet, GroupSetContainer } from "./model.js";
export { readGroupContainer, readGroupQuery, readGroupSetContainer } from "./read.js";
export { writeGroupContainer, writeGroupQuery, writeGroupSetContainer } from "./write.js";
