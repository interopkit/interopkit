import { isDateTime, isRecord } from "@interopkit/core/checks";
import type { Result, Statement, StatementIssue, SubStatement, XapiVersion } from "../model/index.js";
import {
  hasFinerThanCentiseconds,
  hasMillisecondPrecision,
  isUtc,
  STATEMENT_VERSIONS,
  splitDuration,
} from "../model/internal.js";
import { error, warning } from "./finding.js";
import { item, member } from "./path.js";

/**
 * Judges a time of a Statement of 1.0.3: ISO 8601 allows forms that RFC 3339 does not, such as the basic format, and a
 * Timestamp should be expressed as RFC 3339 (Data 4.5), which the provider rules hold as a requirement.
 */
function rfc3339Issues(timestamp: string, path: string): StatementIssue[] {
  if (isDateTime(timestamp)) return [];
  return [
    error(
      path,
      "timestamp-not-rfc3339",
      `expected a time as RFC 3339, such as 2024-06-13T18:46:03.000Z, found ${JSON.stringify(timestamp)}.`,
    ),
  ];
}

/**
 * Judges a time of a Statement: a provider of 2.0 writes UTC (5.2.7), and should write at least milliseconds; a provider of
 * 1.0.3 writes RFC 3339.
 */
function timeIssues(timestamp: string | undefined, path: string, version: XapiVersion): StatementIssue[] {
  if (timestamp === undefined) return [];
  if (version === "1.0.3") return rfc3339Issues(timestamp, path);
  const issues: StatementIssue[] = [];
  if (!isUtc(timestamp)) {
    issues.push(
      error(
        path,
        "timestamp-not-utc",
        `expected a time in UTC, such as 2024-06-13T18:46:03.000Z, found ${JSON.stringify(timestamp)}.`,
      ),
    );
  }
  if (!hasMillisecondPrecision(timestamp)) {
    issues.push(
      warning(
        path,
        "timestamp-precision",
        `expected at least millisecond precision, found ${JSON.stringify(timestamp)}.`,
      ),
    );
  }
  return issues;
}

/** Judges the time of a Statement or a SubStatement as the provider rules of a version ask. */
export function providerTimeIssues(
  statement: Statement | SubStatement,
  path: string,
  version: XapiVersion,
): StatementIssue[] {
  return timeIssues(statement.timestamp, member(path, "timestamp"), version);
}

/**
 * Judges what a Learning Record Provider is asked of the Statement as a whole (5.2.4.1; 1.0.3 Data 2.4.1, 2.4.10): an id,
 * and no `stored`, no `authority` and no `version` unless it is the version of the rules, 2.0.0 or 1.0.0; the time that it
 * does send is in the form of its version.
 */
export function providerStatementIssues(statement: Statement, version: XapiVersion): StatementIssue[] {
  const expected = STATEMENT_VERSIONS[version];
  const issues: StatementIssue[] = [];
  if (statement.id === undefined) {
    issues.push(
      warning(
        "id",
        "missing-property",
        'missing the property "id", which a provider should send so that a resend repeats it.',
      ),
    );
  }
  issues.push(...timeIssues(statement.stored, "stored", version));
  for (const name of ["stored", "authority"] as const) {
    if (statement[name] !== undefined)
      issues.push(warning(name, "lrs-managed-property", `expected no ${name}, which the LRS sets.`));
  }
  if (statement.version === expected) {
    issues.push(warning("version", "lrs-managed-property", "expected no version, which the LRS sets."));
  } else if (statement.version !== undefined) {
    issues.push(
      error(
        "version",
        "invalid-value",
        `expected ${JSON.stringify(expected)}, found ${JSON.stringify(statement.version)}.`,
      ),
    );
  }
  return issues;
}

/** Judges the duration of a Result: a provider should write no more than 0.01 second of precision (5.2.7). */
export function providerResultIssues(result: Result, path: string): StatementIssue[] {
  const parts = result.duration === undefined ? undefined : splitDuration(result.duration);
  if (parts === undefined || !hasFinerThanCentiseconds(parts)) return [];
  return [
    warning(
      member(path, "duration"),
      "duration-precision",
      `expected at most 0.01 second of precision, found ${JSON.stringify(result.duration)}.`,
    ),
  ];
}

/** Lists the properties of a value of JSON whose value is an empty object, leaving the values of extensions alone. */
function* emptyObjects(value: unknown, path: string): Generator<StatementIssue> {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) yield* emptyObjects(entry, item(path, index));
  } else if (isRecord(value)) {
    for (const [name, property] of Object.entries(value)) {
      const at = member(path, name);
      if (isRecord(property) && Object.keys(property).length === 0) {
        yield warning(at, "empty-object", "expected the property to be left out, found an empty object.");
      } else if (name !== "extensions") {
        yield* emptyObjects(property, at);
      }
    }
  }
}

/**
 * Judges a Statement for properties whose value is an empty object, which a provider of 2.0 should leave out (5.2.4.1) and a
 * Statement of 1.0.3 should not include (Data 2.2).
 */
export function emptyObjectIssues(statement: Statement): Iterable<StatementIssue> {
  return emptyObjects(statement, "");
}

/**
 * Judges the `contextActivities` of a Statement as it was written, for a value that is a single Activity and not a list,
 * which a provider should not write (5.2.4.1). It reads the input and not the Statement, because reading turns a single
 * Activity into a list of one.
 *
 * @param input - A Statement or a SubStatement that has passed the schema.
 */
export function* singleActivityIssues(input: unknown, path: string): Generator<StatementIssue> {
  if (!isRecord(input)) return;
  const base = member(member(path, "context"), "contextActivities");
  const activities = isRecord(input.context) ? input.context.contextActivities : undefined;
  for (const [type, value] of Object.entries(isRecord(activities) ? activities : {})) {
    if (!Array.isArray(value)) {
      yield warning(member(base, type), "single-activity", "expected a list of Activities, found a single Activity.");
    }
  }
  if (isRecord(input.object) && input.object.objectType === "SubStatement") {
    yield* singleActivityIssues(input.object, member(path, "object"));
  }
}
