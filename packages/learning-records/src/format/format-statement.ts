import type { Statement } from "../model/index.js";
import { readStatement } from "../read/index.js";
import { canonicalMappers } from "./format-canonical.js";
import { IDS } from "./format-ids.js";
import { type FormatOptions, readFormat, readFormatOptions, type StatementFormat } from "./options.js";
import { mapStatement } from "./transform.js";

/**
 * Returns a Statement in one of the formats that an LRS answers a query with (4.1.6.1): `exact`, the Statement as it is;
 * `ids`, with only the identifiers of its Agents, Groups, Activities and Verbs; or `canonical`, with the canonical definitions
 * of its Activities and one language in each language map.
 *
 * @remarks
 * The result shares nothing with the input. Properties other than Agents, Groups, Activities and Verbs are the same in every
 * format; an Agent as the Object keeps its `objectType`, since the Statement would otherwise read as an Activity. The Statement
 * is read as an LRS reads it first, so one that breaks a rule is refused.
 *
 * @param statement - The Statement, as an LRS holds it.
 * @param format - `ids`, `exact` or `canonical`.
 * @param options - The canonical definitions and the languages, for `canonical`.
 * @returns The Statement in the format.
 * @throws `DataError` when the Statement, the format or the options are not valid.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function formatStatement(statement: Statement, format: StatementFormat, options?: FormatOptions): Statement {
  const checkedFormat = readFormat(format);
  const { activities = new Map(), languages = [] } = readFormatOptions(options);
  const read = readStatement(statement);
  if (checkedFormat === "exact") return read;
  return mapStatement(read, checkedFormat === "ids" ? IDS : canonicalMappers(activities, languages));
}
