import { DataError } from "@interopkit/core";
import { jsonObjectSchema, parseWith } from "@interopkit/core/checks";
import { searchValue } from "../claims/index.js";
import type { PreferencesQuery, PreferencesRecord } from "./model.js";

/**
 * Reads the record that the preferences endpoint answers: a JSON object, copied.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` when it is not a JSON object.
 */
export function readPreferencesRecord(value: unknown): PreferencesRecord {
  return parseWith(jsonObjectSchema, value, "The preferences record");
}

/**
 * Reads the filters of a request for a record: `fields`, a comma-separated list. An unknown parameter is ignored.
 *
 * @throws `DataError` when `fields` is given twice or names an empty field.
 */
export function readPreferencesQuery(search: URLSearchParams): PreferencesQuery {
  const text = searchValue(search, "fields", "preferences query");
  if (text === undefined) return {};
  const fields = text.split(",");
  if (fields.some((field) => field === "")) {
    throw new DataError(
      `The parameter fields of the preferences query must list fields that are not empty, found ${JSON.stringify(text)}.`,
    );
  }
  return { fields };
}
