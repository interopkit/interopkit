import { DataError } from "@interopkit/core";
import { describe, parseDateTime } from "@interopkit/core/checks";

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

/** The first millisecond that RFC 3339 can write with a year of four digits: 0000-01-01T00:00:00.000Z. */
const EARLIEST = -62_167_219_200_000;

/** The last millisecond that RFC 3339 can write with a year of four digits: 9999-12-31T23:59:59.999Z. */
const LATEST = 253_402_300_799_999;

/**
 * Writes a time as a Timestamp of a provider (5.2.7): RFC 3339 in UTC with millisecond precision, such as
 * `2024-06-13T18:46:03.250Z`.
 *
 * @param at - Epoch milliseconds, or an RFC 3339 date and time with any offset, which is converted to UTC.
 * @returns The Timestamp.
 * @throws `DataError` when it is neither, or is outside the years 0000 to 9999.
 * @see {@link https://www.rfc-editor.org/rfc/rfc3339 | RFC 3339}
 */
export function formatTimestamp(at: number | string): string {
  const milliseconds = typeof at === "string" ? parseDateTime(at) : at;
  if (
    typeof milliseconds !== "number" ||
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < EARLIEST ||
    milliseconds > LATEST
  ) {
    throw new DataError(
      `The time must be epoch milliseconds or an RFC 3339 date and time, in the years 0000 to 9999, found ${describe(at)}.`,
    );
  }
  return new Date(milliseconds).toISOString();
}
