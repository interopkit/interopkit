import * as v from "valibot";

/** A date and time of RFC 3339 section 5.6: `T`, a time with at most a fraction of a second, and an offset. */
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/u;

/** A full date of RFC 3339 section 5.6. */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** The scheme of a URI, and a text without white space after it (RFC 3986 section 3.1). */
const ABSOLUTE_URI = /^[A-Za-z][A-Za-z0-9+.-]*:\S*$/u;

/** The most days of each month of a leap year, January first. */
const DAYS_OF_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const LAST_HOUR = 23;
const LAST_MINUTE = 59;
const LAST_SECOND = 59;
/** The second that a leap second adds, which RFC 3339 allows at the end of a day. */
const LEAP_SECOND = 60;
const MS_PER_MINUTE = 60_000;
/** The digits of a fraction of a second that milliseconds keep. */
const MS_DIGITS = 3;

/** Tells whether a year has a 29th of February. */
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Tells whether the numbers are a day of the calendar. */
function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const days = DAYS_OF_MONTH[month - 1] ?? 0;
  return day <= (month === 2 && !isLeapYear(year) ? days - 1 : days);
}

/**
 * Tells whether text is a date of the calendar in the form `YYYY-MM-DD` (RFC 3339 section 5.6).
 *
 * @remarks
 * The `isoDate` of valibot is a pattern that accepts `2023-02-31`; this function knows the days of each month and the leap
 * years.
 *
 * @param text - The text.
 * @returns Whether it is a date that exists.
 */
export function isDate(text: string): boolean {
  const match = DATE.exec(text);
  return match !== null && isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/**
 * Reads a date and time of RFC 3339 section 5.6 with an offset, such as `2024-06-13T18:46:03.250+00:00`, into milliseconds
 * since 1970-01-01T00:00:00Z, or returns `undefined` when the text is not one.
 *
 * @remarks
 * The date must exist, the time must have an hour to 23, a minute to 59 and a second to 59, or 60 at 23:59, and the offset
 * is `Z` or a sign and `hh:mm` of at most 23:59. `T` and `Z` may be lower case, as RFC 3339 allows. A fraction of a second
 * keeps its first three digits. The `isoTimestamp` of valibot is a pattern that accepts a date that does not exist, which
 * is why this function reads the parts itself. `parseDateTime` of `checks.ts` is this function that throws.
 *
 * @param text - The text.
 * @returns The instant in milliseconds, or `undefined` when the text is not a date and time of RFC 3339.
 */
export function findInstant(text: string): number | undefined {
  const match = DATE_TIME.exec(text);
  if (match === null) return undefined;
  // The pattern holds every part, so that the empty strings stand in only for what the types leave possibly absent.
  const [, yearText = "", monthText = "", dayText = "", hourText = "", minuteText = "", secondText = ""] = match;
  const [year, month, day] = [Number(yearText), Number(monthText), Number(dayText)];
  const [hour, minute, second] = [Number(hourText), Number(minuteText), Number(secondText)];
  const [offsetHour, offsetMinute] = [Number(match[9] ?? 0), Number(match[10] ?? 0)];
  const secondFits = second <= LAST_SECOND || (second === LEAP_SECOND && hour === LAST_HOUR && minute === LAST_MINUTE);
  const fits = isCalendarDate(year, month, day) && hour <= LAST_HOUR && minute <= LAST_MINUTE && secondFits;
  if (!fits || offsetHour > LAST_HOUR || offsetMinute > LAST_MINUTE) return undefined;
  const local = new Date(0);
  // `setUTCFullYear` keeps years below 100 as they are, which `Date.UTC` reads as 1900 and more.
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, Number((match[7] ?? "").padEnd(MS_DIGITS, "0").slice(0, MS_DIGITS)));
  const sign = match[8] === "-" ? -1 : 1;
  return local.getTime() - sign * (offsetHour * 60 + offsetMinute) * MS_PER_MINUTE;
}

/**
 * Tells whether text is a date and time of RFC 3339 section 5.6 with an offset.
 *
 * @param text - The text.
 * @returns Whether `parseDateTime` reads it.
 */
export function isDateTime(text: string): boolean {
  return findInstant(text) !== undefined;
}

/**
 * Tells whether text is a URI with a scheme, which `URL` parses: `https://example.org/x`, `urn:uuid:...`, `mailto:a@b.example`.
 *
 * @param text - The text.
 * @returns Whether it is.
 */
export function isAbsoluteUri(text: string): boolean {
  return ABSOLUTE_URI.test(text) && URL.canParse(text);
}

const ALPHA = "[A-Za-z]";
const DIGIT = "[0-9]";
const ALPHANUMERIC = "[A-Za-z0-9]";
/**
 * A well-formed language tag in the order of the ABNF of RFC 5646 section 2.1: a language with up to three extended
 * languages, a script, a region, variants, extensions and private use. The classes name both cases of a letter, because the
 * `i` flag with `u` also matches the long s and the Kelvin sign.
 */
const LANGUAGE_PATTERN = [
  `(?:${ALPHA}{2,3}(?:-${ALPHA}{3}(?:-${ALPHA}{3}){0,2})?|${ALPHA}{4}|${ALPHA}{5,8})`,
  `(?:-${ALPHA}{4})?`,
  `(?:-(?:${ALPHA}{2}|${DIGIT}{3}))?`,
  `(?:-(?:${ALPHANUMERIC}{5,8}|${DIGIT}${ALPHANUMERIC}{3}))*`,
  `(?:-[0-9A-WY-Za-wy-z](?:-${ALPHANUMERIC}{2,8})+)*`,
  `(?:-[Xx](?:-${ALPHANUMERIC}{1,8})+)?`,
].join("");
const LANGUAGE_TAG = new RegExp(`^(?:${LANGUAGE_PATTERN}|[Xx](?:-${ALPHANUMERIC}{1,8})+)$`, "u");
/**
 * The most characters of a language tag. RFC 5646 section 4.4.1 asks for room for 35, and a pattern with quantified groups runs
 * out of stack at some millions of subtags, so a longer text is not read as a tag.
 */
const MAX_LANGUAGE_TAG_LENGTH = 1024;

/** The tags that RFC 5646 section 2.2.8 keeps from RFC 3066 and that the grammar above does not produce, in lower case. */
const GRANDFATHERED: ReadonlySet<string> = new Set([
  "en-gb-oed",
  "i-ami",
  "i-bnn",
  "i-default",
  "i-enochian",
  "i-hak",
  "i-klingon",
  "i-lux",
  "i-mingo",
  "i-navajo",
  "i-pwn",
  "i-tao",
  "i-tay",
  "i-tsu",
  "sgn-be-fr",
  "sgn-be-nl",
  "sgn-ch-de",
  "art-lojban",
  "cel-gaulish",
  "no-bok",
  "no-nyn",
  "zh-guoyu",
  "zh-hakka",
  "zh-min",
  "zh-min-nan",
  "zh-xiang",
]);

/**
 * Tells whether text is a language tag that is well-formed by RFC 5646 section 2.1, such as `en`, `zh-Hant-TW` or
 * `x-private`.
 *
 * @remarks
 * The check is of the form of the subtags, which is what xAPI asks an LRS to validate. It does not look a subtag up in the
 * registry of IANA, so `qq` is well-formed and names no language. `Intl.getCanonicalLocales` is not used because it follows
 * the grammar of Unicode locale identifiers, which is stricter than RFC 5646, and it differs between engines.
 *
 * @param text - The text.
 * @returns Whether it is a well-formed tag.
 * @see {@link https://www.rfc-editor.org/rfc/rfc5646#section-2.1 | RFC 5646 section 2.1}
 */
export function isLanguageTag(text: string): boolean {
  return text.length <= MAX_LANGUAGE_TAG_LENGTH && (LANGUAGE_TAG.test(text) || GRANDFATHERED.has(text.toLowerCase()));
}

/** A UUID as 8-4-4-4-12 hexadecimal digits of either case: the form that the JSON schemas of 1EdTech ask for. */
export const uuidSchema = v.pipe(
  v.string(),
  v.uuid((issue) => `expected a UUID as 8-4-4-4-12 hexadecimal digits, found ${issue.received}`),
);

/** A date that exists, as `YYYY-MM-DD`. */
export const dateSchema = v.pipe(
  v.string(),
  v.check(isDate, (issue) => `expected a date as YYYY-MM-DD, found ${issue.received}`),
);

/** A date and time of RFC 3339 with an offset, such as `2024-06-13T18:46:03+00:00`. */
export const dateTimeSchema = v.pipe(
  v.string(),
  v.check(
    isDateTime,
    (issue) => `expected a date and time as RFC 3339, such as 2024-06-13T18:46:03+00:00, found ${issue.received}`,
  ),
);

/** A URI with a scheme, such as `https://example.org/x`. */
export const absoluteUriSchema = v.pipe(
  v.string(),
  v.check(
    isAbsoluteUri,
    (issue) => `expected a URI with a scheme, such as https://example.org/x, found ${issue.received}`,
  ),
);

/** A language tag that is well-formed by RFC 5646, such as `en-US`. */
export const languageTagSchema = v.pipe(
  v.string(),
  v.check(isLanguageTag, (issue) => `expected a language tag of RFC 5646, such as en-US, found ${issue.received}`),
);

/**
 * Tells whether text is a UUID as 8-4-4-4-12 hexadecimal digits of either case.
 *
 * @param text - The text.
 * @returns Whether it is.
 */
export function isUuid(text: string): boolean {
  return v.is(uuidSchema, text);
}
