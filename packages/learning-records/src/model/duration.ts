import { checkNonNegativeInteger } from "@interopkit/core/checks";

/** The components of an ISO 8601 duration as written, each as the text before its designator; absent when the text has none. */
export interface DurationParts {
  readonly years?: string;
  readonly months?: string;
  readonly weeks?: string;
  readonly days?: string;
  readonly hours?: string;
  readonly minutes?: string;
  readonly seconds?: string;
}

/** A number with an optional decimal fraction, written with a point or a comma (ISO 8601 4.4.3.2). */
const NUMBER = "(\\d+(?:[.,]\\d+)?)";

/**
 * The duration of ISO 8601:2004 4.4.3.2: `PnW`, or `PnYnMnDTnHnMnS` with every component optional. The alternative format
 * of 4.4.3.3, `P0001-00-00T00:00:00`, does not match.
 */
const DURATION = new RegExp(
  `^P(?:${NUMBER}W|(?:${NUMBER}Y)?(?:${NUMBER}M)?(?:${NUMBER}D)?(?:T(?:${NUMBER}H)?(?:${NUMBER}M)?(?:${NUMBER}S)?)?)$`,
  "u",
);

/** The digits of a fraction of a second that xAPI keeps in a comparison: 0.01 second (4.2.7). */
const DURATION_FRACTION_DIGITS = 2;

/**
 * Splits text that is an ISO 8601 duration into its components. ISO 8601 allows a decimal fraction on the smallest component
 * only, and a duration needs at least one component; `PT` and `P1DT` have a `T` and no time component.
 *
 * @returns The components, or `undefined` when the text is not a duration of the form 4.4.3.2.
 */
export function splitDuration(text: string): DurationParts | undefined {
  const match = DURATION.exec(text);
  if (match === null || text.endsWith("T")) return undefined;
  const [, weeks, years, months, days, hours, minutes, seconds] = match;
  const parts = { years, months, weeks, days, hours, minutes, seconds };
  const written = Object.values(parts).filter((part) => part !== undefined);
  if (written.length === 0) return undefined;
  if (written.slice(0, -1).some((part) => /[.,]/u.test(part))) return undefined;
  return Object.fromEntries(Object.entries(parts).filter(([, part]) => part !== undefined));
}

/** Tells whether text is a duration of ISO 8601:2004 4.4.3.2. */
export function isDuration(text: string): boolean {
  return splitDuration(text) !== undefined;
}

/**
 * Tells whether the seconds of a duration have more digits after the point than xAPI keeps in a comparison, which is more
 * precision than 0.01 second.
 */
export function hasFinerThanCentiseconds(parts: DurationParts): boolean {
  const fraction = /[.,](\d+)$/u.exec(parts.seconds ?? "")?.[1] ?? "";
  return fraction.length > DURATION_FRACTION_DIGITS;
}

/** The time, in whole units, that a duration of the time components is made of: milliseconds in a centisecond and so on. */
const CENTISECONDS_PER_SECOND = 100;
const CENTISECONDS_PER_MINUTE = 6000;
const CENTISECONDS_PER_HOUR = 360_000;
const MILLISECONDS_PER_CENTISECOND = 10;
const DAYS_PER_WEEK = 7;

/** A duration as its components, in the unit of each. Weeks are counted as days. */
export interface Duration {
  /** Years, as written; a fraction only if the year is the smallest component. */
  readonly years: number;
  /** Months. */
  readonly months: number;
  /** Days, with 7 days for each week. */
  readonly days: number;
  /** Hours. */
  readonly hours: number;
  /** Minutes. */
  readonly minutes: number;
  /** Seconds, with the fraction as written. */
  readonly seconds: number;
}

/** Reads a component of a duration as a number: absent is 0, and a comma is a decimal point. */
function numberOf(part: string | undefined): number {
  return part === undefined ? 0 : Number(part.replace(",", "."));
}

/**
 * Reads an ISO 8601 duration into its components.
 *
 * @remarks
 * The form is that of ISO 8601:2004 4.4.3.2, which xAPI asks for (4.2.7): `PnW`, or `PnYnMnDTnHnMnS` with every component
 * optional and a fraction only on the smallest. A year and a month have no fixed length, so the components are not added up.
 * A time of days, hours, minutes and seconds is `((days * 24 + hours) * 60 + minutes) * 60 + seconds` seconds.
 *
 * @param text - The duration, such as `PT1H30M`.
 * @returns The components, or `undefined` when the text is not a duration of that form.
 */
export function parseDuration(text: string): Duration | undefined {
  const parts = splitDuration(text);
  return parts === undefined ? undefined : componentsOf(parts);
}

/** Reads the parts of a duration as numbers. */
function componentsOf(parts: DurationParts): Duration {
  return {
    years: numberOf(parts.years),
    months: numberOf(parts.months),
    days: numberOf(parts.days) + numberOf(parts.weeks) * DAYS_PER_WEEK,
    hours: numberOf(parts.hours),
    minutes: numberOf(parts.minutes),
    seconds: numberOf(parts.seconds),
  };
}

/**
 * Writes a length of time as an ISO 8601 duration of hours, minutes and seconds, at the precision of 0.01 second that xAPI
 * keeps (4.2.7): a finer time is cut and not rounded, and a component that is zero is left out.
 *
 * @param milliseconds - The length of time, a whole number of milliseconds from 0.
 * @returns The duration: `PT0S` for none, `PT1H30M` for an hour and a half, `PT0.09S` for 90 milliseconds.
 * @throws `DataError` when it is not a safe integer of at least 0.
 */
export function formatDuration(milliseconds: number): string {
  checkNonNegativeInteger(milliseconds, "The duration in milliseconds");
  const centiseconds = Math.floor(milliseconds / MILLISECONDS_PER_CENTISECOND);
  const hours = Math.floor(centiseconds / CENTISECONDS_PER_HOUR);
  const minutes = Math.floor((centiseconds % CENTISECONDS_PER_HOUR) / CENTISECONDS_PER_MINUTE);
  const wholeSeconds = Math.floor((centiseconds % CENTISECONDS_PER_MINUTE) / CENTISECONDS_PER_SECOND);
  const fraction = String(centiseconds % CENTISECONDS_PER_SECOND)
    .padStart(2, "0")
    .replace(/0+$/u, "");
  const seconds = `${wholeSeconds}${fraction === "" ? "" : `.${fraction}`}`;
  const written = [
    hours > 0 ? `${hours}H` : "",
    minutes > 0 ? `${minutes}M` : "",
    seconds === "0" ? "" : `${seconds}S`,
  ].join("");
  return written === "" ? "PT0S" : `PT${written}`;
}

/** Counts the centiseconds of a component, cut at 0.01 second, from the decimal text and not from a number that rounds. */
function centisecondsOf(part: string | undefined, centisecondsPerUnit: number): bigint {
  if (part === undefined) return 0n;
  const [whole = "", fraction = ""] = part.replace(",", ".").split(".");
  return (BigInt(`${whole}${fraction}`) * BigInt(centisecondsPerUnit)) / 10n ** BigInt(fraction.length);
}

/**
 * Writes a key for the comparison of durations: two durations have one key when their years, months and days are the same and
 * their time is the same to 0.01 second, whatever units write it (`PT1H`, `PT60M` and `PT3600.004S`).
 */
export function durationKey(text: string): string | undefined {
  const parts = splitDuration(text);
  if (parts === undefined) return undefined;
  const { years, months, days } = componentsOf(parts);
  const time =
    centisecondsOf(parts.hours, CENTISECONDS_PER_HOUR) +
    centisecondsOf(parts.minutes, CENTISECONDS_PER_MINUTE) +
    centisecondsOf(parts.seconds, CENTISECONDS_PER_SECOND);
  return `${years}Y${months}M${days}D${time}`;
}
