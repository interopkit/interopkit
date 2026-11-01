import { isRecord } from "@interopkit/core/checks";
import type { Result, Statement, StatementIssue, SubStatement } from "../model/index.js";
import { hasFinerThanCentiseconds, hasMillisecondPrecision, isUtc, splitDuration } from "../model/internal.js";
import { error, warning } from "./finding.js";
import { item, member } from "./path.js";

/** The version of the Statements that a Learning Record Provider writes (5.2.4.1). */
const PROVIDER_VERSION = "2.0.0";

/** Judges a time of a Statement: a provider writes UTC (5.2.7), and should write at least milliseconds. */
function timeIssues(timestamp: string | undefined, path: string): StatementIssue[] {
  if (timestamp === undefined) return [];
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

/** Judges the time of a Statement or a SubStatement: a provider writes UTC, with at least milliseconds (5.2.7). */
export function providerTimeIssues(statement: Statement | SubStatement, path: string): StatementIssue[] {
  return timeIssues(statement.timestamp, member(path, "timestamp"));
}

/**
 * Judges what a Learning Record Provider is asked of the Statement as a whole (5.2.4.1): an id, and no `stored`, no
 * `authority` and no `version` unless it is 2.0.0; the time that it does send is in UTC.
 */
export function providerStatementIssues(statement: Statement): StatementIssue[] {
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
  issues.push(...timeIssues(statement.stored, "stored"));
  for (const name of ["stored", "authority"] as const) {
    if (statement[name] !== undefined)
      issues.push(warning(name, "lrs-managed-property", `expected no ${name}, which the LRS sets.`));
  }
  if (statement.version === PROVIDER_VERSION) {
    issues.push(warning("version", "lrs-managed-property", "expected no version, which the LRS sets."));
  } else if (statement.version !== undefined) {
    issues.push(
      error(
        "version",
        "invalid-value",
        `expected ${JSON.stringify(PROVIDER_VERSION)}, found ${JSON.stringify(statement.version)}.`,
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

/** Collects the properties of a value of JSON whose value is an empty object, leaving the values of extensions alone. */
function emptyObjects(value: unknown, path: string, issues: StatementIssue[]): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) emptyObjects(entry, item(path, index), issues);
  } else if (isRecord(value)) {
    for (const [name, property] of Object.entries(value)) {
      const at = member(path, name);
      if (isRecord(property) && !Array.isArray(property) && Object.keys(property).length === 0) {
        issues.push(warning(at, "empty-object", "expected the property to be left out, found an empty object."));
      } else if (name !== "extensions") {
        emptyObjects(property, at, issues);
      }
    }
  }
}

/** Judges a Statement for properties whose value is an empty object, which a provider should leave out (5.2.4.1). */
export function emptyObjectIssues(statement: Statement): StatementIssue[] {
  const issues: StatementIssue[] = [];
  emptyObjects(statement, "", issues);
  return issues;
}

/**
 * Judges the `contextActivities` of a Statement as it was written, for a value that is a single Activity and not a list,
 * which a provider should not write (5.2.4.1). It reads the input and not the Statement, because reading turns a single
 * Activity into a list of one.
 *
 * @param input - A Statement or a SubStatement that has passed the schema.
 */
export function singleActivityIssues(input: unknown, path: string): StatementIssue[] {
  if (!isRecord(input)) return [];
  const issues: StatementIssue[] = [];
  const base = member(member(path, "context"), "contextActivities");
  const activities = isRecord(input.context) ? input.context.contextActivities : undefined;
  for (const [type, value] of Object.entries(isRecord(activities) ? activities : {})) {
    if (!Array.isArray(value)) {
      issues.push(
        warning(member(base, type), "single-activity", "expected a list of Activities, found a single Activity."),
      );
    }
  }
  if (isRecord(input.object) && input.object.objectType === "SubStatement") {
    issues.push(...singleActivityIssues(input.object, member(path, "object")));
  }
  return issues;
}
