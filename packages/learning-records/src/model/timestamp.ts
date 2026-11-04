import { findInstant, findIsoInstant } from "@interopkit/core/checks";
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
 * Reads the time of a Statement of either version into epoch milliseconds: the `timestamp` of 2.0 is a date and time of
 * RFC 3339 (Data 4.5), and that of 1.0.3 is one of ISO 8601 with a time zone, in the extended or the basic format.
 *
 * @param statement - The Statement.
 * @returns The instant in milliseconds, or `undefined` for a Statement without a `timestamp` or with one that is neither.
 */
export function findStatementTime(statement: Statement): number | undefined {
  const { timestamp } = statement;
  return timestamp === undefined ? undefined : (findInstant(timestamp) ?? findIsoInstant(timestamp));
}
