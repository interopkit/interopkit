import { isDateTime, parseDateTime } from "@interopkit/core/checks";

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

/** Reads an RFC 3339 date and time into epoch milliseconds, or returns `undefined` for a text that is not one. */
export function findInstant(text: string): number | undefined {
  return isDateTime(text) ? parseDateTime(text) : undefined;
}

/**
 * A combined date and time of ISO 8601 in the extended format with a zone, as xAPI 1.0.3 writes a Timestamp (Data 4.5): the
 * minutes and seconds may be left out, the seconds may have a fraction, and the zone is `Z`, `±hh` or `±hh:mm`.
 */
const ISO_EXTENDED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(?::(\d{2})(?::(\d{2})(\.\d+)?)?)?(Z|[+-]\d{2}(?::\d{2})?)$/u;

/** The same in the basic format of ISO 8601, without separators: `20240613T184603.250Z`, with a zone `Z`, `±hh` or `±hhmm`. */
const ISO_BASIC = /^(\d{4})(\d{2})(\d{2})T(\d{2})(?:(\d{2})(?:(\d{2})(\.\d+)?)?)?(Z|[+-]\d{2}(?:\d{2})?)$/u;

/**
 * Reads a Timestamp of xAPI 1.0.3 (Data 4.5): ISO 8601, extended or basic, with a time zone. A zone of minus zero, such as
 * `-00:00`, which RFC 3339 allows for an unknown offset and ISO 8601 does not, is refused, as is a date that does not exist.
 *
 * @returns Epoch milliseconds, or `undefined` for a text that is not such a Timestamp.
 */
export function parseIsoTimestamp(text: string): number | undefined {
  const match = ISO_EXTENDED.exec(text) ?? ISO_BASIC.exec(text);
  if (match === null) return undefined;
  const [, year = "", month = "", day = "", hour = "", minute = "00", second = "00", fraction = "", zone = ""] = match;
  if (zone === "Z") return findInstant(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}Z`);
  const digits = zone.slice(1).replace(":", "");
  const [offsetHour, offsetMinute] = [digits.slice(0, 2), digits.slice(2) || "00"];
  if (zone.startsWith("-") && offsetHour === "00" && offsetMinute === "00") return undefined;
  const offset = `${zone.charAt(0)}${offsetHour}:${offsetMinute}`;
  return findInstant(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${offset}`);
}

/** Tells whether text is a Timestamp of xAPI 1.0.3: ISO 8601 with a time zone, other than minus zero. */
export function isIsoTimestamp(text: string): boolean {
  return parseIsoTimestamp(text) !== undefined;
}
