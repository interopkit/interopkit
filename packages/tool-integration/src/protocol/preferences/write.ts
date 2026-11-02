import { DataError } from "@interopkit/core";
import type { PreferencesQuery } from "./model.js";

/**
 * Writes the filters of a request for a record as query parameters.
 *
 * @throws `DataError` when a field is empty or has a comma.
 */
export function writePreferencesQuery(query: PreferencesQuery): URLSearchParams {
  const { fields } = query;
  if (fields === undefined) return new URLSearchParams();
  if (fields.length === 0 || fields.some((field) => field === "" || field.includes(","))) {
    throw new DataError(
      "The fields of a preferences query must be a list of names that are not empty and have no comma.",
    );
  }
  return new URLSearchParams([["fields", fields.join(",")]]);
}
