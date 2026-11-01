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
