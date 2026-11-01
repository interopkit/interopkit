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
