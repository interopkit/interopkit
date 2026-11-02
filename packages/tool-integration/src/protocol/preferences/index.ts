/**
 * The body of the AfA PNP Connector: the record of a user's needs and preferences, and the filters of its request.
 *
 * @module
 */
export type { PreferencesQuery, PreferencesRecord } from "./model.js";
export { readPreferencesQuery, readPreferencesRecord } from "./read.js";
export { writePreferencesQuery } from "./write.js";
