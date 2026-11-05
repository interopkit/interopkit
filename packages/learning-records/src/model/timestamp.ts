import { checkRecord, findInstant, findIsoInstant } from "@interopkit/core/checks";
import type { Statement } from "./statement.js";

/** A time zone that is UTC: `Z`, or an offset of zero (RFC 3339 section 4.3). */
const UTC_ZONE = /(?:[Zz]|[+-]00:00)$/u;

/** A fraction of a second of at least three digits, which is millisecond precision. */
const MILLISECONDS = /\.\d{3,}(?:[Zz]|[+-]\d{2}:\d{2})$/u;

/** Tells whether the time zone of an RFC 3339 date and time is UTC. */
export function isUtc(timestamp: string): boolean {
  return UTC_ZONE.test(timestamp);
}

/** Tells whether an RFC 3339 date and time has a fraction of a second of at least three digits. */
export function hasMillisecondPrecision(timestamp: string): boolean {
  return MILLISECONDS.test(timestamp);
}

/** Tells whether text is a Timestamp of xAPI 1.0.3: ISO 8601 with a time zone, other than minus zero. */
export function isIsoTimestamp(text: string): boolean {
  return findIsoInstant(text) !== undefined;
}

/**
 * A date and time of a Statement of 2.0 in a form that an LRS takes and writes in UTC (4.2.7): RFC 3339 with `T`, `t` or a space
 * between the date and the time, seconds that may be left out, a fraction of a second, and `Z` or an offset.
 */
const TAKEN_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2})(?::(\d{2})(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/u;

/**
 * Writes a date and time in a form that an LRS of 2.0 takes as RFC 3339 writes it, with `T` and the seconds, or returns
 * `undefined` for a text of another form. Whether the date and the time exist is left to `findInstant`.
 */
export function strictDateTime(text: string): string | undefined {
  const match = TAKEN_DATE_TIME.exec(text);
  if (match === null) return undefined;
  const [, date = "", time = "", seconds = "00", fraction = "", zone = ""] = match;
  return `${date}T${time}:${seconds}${fraction}${zone}`;
}

/**
 * Reads the time of a Statement of either version into epoch milliseconds: the `timestamp` of 2.0 is a date and time of
 * RFC 3339 (Data 4.5), in the forms that an LRS takes (a space or `t` between the date and the time, the seconds left out), and
 * that of 1.0.3 is one of ISO 8601 with a time zone, in the extended or the basic format.
 *
 * @param statement - The Statement.
 * @returns The instant in milliseconds, or `undefined` for a Statement without a `timestamp` or with one that is neither.
 * @throws `DataError` when the Statement is not an object.
 */
export function findStatementTime(statement: Statement): number | undefined {
  checkRecord(statement, "The statement must be an object");
  const { timestamp } = statement;
  if (typeof timestamp !== "string") return undefined;
  const strict = strictDateTime(timestamp);
  return (strict === undefined ? undefined : findInstant(strict)) ?? findIsoInstant(timestamp);
}
