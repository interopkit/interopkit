import { DataError } from "@interopkit/core";
import { copyJson, describe, type JsonValue, parseDateTime } from "@interopkit/core/checks";
import * as v from "valibot";

/** The members of a JSON object that a writer builds, where a member that is `undefined` is left out. */
export interface Members {
  /** A member of the object. */
  readonly [name: string]: JsonValue | undefined;
}

/** Drops the members that are `undefined`. */
export function compact(members: Members): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(members).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}

/** Returns whether the name of a member is a fully qualified URL, as LTI requires of the name of an extension (Core 5.4.7, AGS 3.1, DL 3). */
export function isExtensionName(name: string): boolean {
  return /^https?:\/\//u.test(name) && URL.canParse(name);
}

/**
 * Returns the extensions of an object that was read: its members whose names are URLs and are not among the ones the model
 * names, copied as JSON. The other members the model does not name are ignored, as a receiver ignores what it does not
 * understand.
 *
 * @param source - The object, as the schema of its class read it.
 * @param known - The URL-named members that the model has a property for.
 * @returns The extensions, or `undefined` when there are none.
 * @throws `DataError` when an extension is not JSON.
 */
export function extensionsOf(
  source: object,
  known: readonly string[] = [],
): Readonly<Record<string, JsonValue>> | undefined {
  const found: [string, JsonValue][] = [];
  for (const [name, member] of Object.entries(source)) {
    if (!isExtensionName(name) || known.includes(name)) continue;
    const copy = copyJson(member, name);
    if ("problem" in copy) throw new DataError(`The extension ${describe(name)} is invalid: ${copy.problem}.`);
    found.push([name, copy.value]);
  }
  return found.length === 0 ? undefined : Object.fromEntries(found);
}

/**
 * Returns the extensions of an object that a writer builds as members of it.
 *
 * @throws `DataError` when a name is not a fully qualified URL, or is a member that the model has a property for.
 */
export function writeExtensions(
  extensions: Readonly<Record<string, JsonValue>> | undefined,
  known: readonly string[] = [],
): Members {
  for (const name of Object.keys(extensions ?? {})) {
    if (!isExtensionName(name) || known.includes(name)) {
      throw new DataError(
        `The name of an extension must be a fully qualified URL that no property of the model uses, found ${describe(name)}.`,
      );
    }
  }
  return extensions ?? {};
}

/**
 * Reads an ISO 8601 date and time with a time zone designator, which LTI requires of every date, into milliseconds since
 * 1970-01-01T00:00:00Z, with an offset of `+hh` read as `+hh:00` (AGS 3.4.9 prints `+00`).
 *
 * @returns The instant, or `undefined` when the text is not such a date and time.
 */
export function parseZonedDateTime(text: string): number | undefined {
  return parseDateTime(/T.*[+-]\d{2}$/u.test(text) ? `${text}:00` : text);
}

/** Returns whether text is an ISO 8601 date and time with a time zone designator. */
function isZonedDateTime(text: string): boolean {
  return parseZonedDateTime(text) !== undefined;
}

/** A date and time with a time zone designator: `Z`, `+hh:mm` or `+hh`. */
export const DATE_TIME = v.pipe(
  v.string(),
  v.check(isZonedDateTime, (issue) => `expected a date and time with a time zone designator, found ${issue.received}`),
);

/** A date and time that a platform may send as `null` or blank when it has none, read as absent. */
export const OPTIONAL_DATE_TIME = v.pipe(
  v.nullish(v.union([DATE_TIME, v.literal("")])),
  v.transform((text) => (text === null || text === "" ? undefined : text)),
);

/**
 * Returns the value of a query parameter that may be given once.
 *
 * @param label - Names the query in the error message, such as `line item query`.
 * @throws `DataError` when the parameter is given more than once.
 */
export function searchValue(search: URLSearchParams, name: string, label: string): string | undefined {
  const all = search.getAll(name);
  if (all.length > 1) {
    throw new DataError(`The ${label} must have the parameter ${name} once, found ${all.length} times.`);
  }
  return all[0];
}

/**
 * Returns the `limit` of a query: a positive integer in decimal digits.
 *
 * @throws `DataError` when it is given twice or is not one.
 */
export function searchLimit(search: URLSearchParams, label: string): number | undefined {
  const text = searchValue(search, "limit", label);
  if (text === undefined) return undefined;
  const limit = Number(text);
  if (!/^\d+$/u.test(text) || !Number.isSafeInteger(limit) || limit < 1) {
    throw new DataError(`The parameter limit of the ${label} must be a positive integer, found ${describe(text)}.`);
  }
  return limit;
}

/**
 * Checks the `limit` that a caller gives for a query.
 *
 * @throws `DataError` when it is given and is not a positive integer.
 */
export function checkLimit(limit: number | undefined, label: string): void {
  if (limit !== undefined && !(Number.isSafeInteger(limit) && limit >= 1)) {
    throw new DataError(`The limit of the ${label} must be a positive integer, found ${describe(limit)}.`);
  }
}

/** Builds the query parameters of the pairs whose value is given. */
export function searchOf(pairs: readonly (readonly [string, string | number | undefined])[]): URLSearchParams {
  return new URLSearchParams(
    pairs.flatMap(([name, value]): [string, string][] => (value === undefined ? [] : [[name, String(value)]])),
  );
}

/** A text that a platform may send as `null` or leave blank when it has none, read as absent. */
export const OPTIONAL_TEXT = v.pipe(
  v.nullish(v.string()),
  v.transform((text) => (text === null || text === undefined || text === "" ? undefined : text)),
);
