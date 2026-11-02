import type { JsonObject } from "@interopkit/core/checks";

/**
 * The record of the personal needs and preferences of a user for an activity, as the AfA PNP Connector's endpoint answers it.
 * The record is JSON and passes through; mapping it to another model is the host's.
 */
export type PreferencesRecord = JsonObject;

/** The filters of a request for a record (AfA PNP Connector 1.0, `fields`). */
export interface PreferencesQuery {
  /** The members of the record to return, all when absent. */
  readonly fields?: readonly string[];
}
