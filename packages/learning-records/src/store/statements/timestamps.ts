import { isRecord, parseDateTime } from "@interopkit/core/checks";
import { isRefusal, type Refusal, refused, type Verdict } from "../verdict.js";

/**
 * A date and time as ISO 8601 and RFC 3339 write it between them: `T` or a space between the date and the time, seconds that
 * may be left out, a fraction of a second, and `Z` or an offset.
 */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2})(?::(\d{2})(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/u;

/** The offset that RFC 3339 allows and ISO 8601 does not: the time is UTC, and the local offset is not known. */
const NEGATIVE_ZERO = "-00:00";

/** What reading a timestamp gives: the time in UTC, a refusal for what the standard forbids, or `undefined` for a text that is no date. */
function utcOf(text: string): string | Refusal | undefined {
  const match = TIMESTAMP.exec(text);
  if (match === null) return undefined;
  const [, date = "", time = "", seconds = "00", fraction = "", zone = ""] = match;
  if (zone === NEGATIVE_ZERO) {
    return refused(
      400,
      `The timestamp ${JSON.stringify(text)} has the offset -00:00, which ISO 8601 does not allow: write Z or +00:00.`,
    );
  }
  const milliseconds = parseDateTime(`${date}T${time}:${seconds}${fraction}${zone}`);
  return milliseconds === undefined ? undefined : new Date(milliseconds).toISOString();
}

/** Writes the `timestamp` of an object in UTC when it is a date and time that is not in UTC form. */
function inUtc(object: Readonly<Record<string, unknown>>, where: string): Verdict<Readonly<Record<string, unknown>>> {
  if (typeof object.timestamp !== "string") return { value: object };
  const utc = utcOf(object.timestamp);
  if (utc === undefined) return { value: object };
  if (typeof utc !== "string") return refused(utc.status, `At ${where}: ${utc.message}`);
  return { value: { ...object, timestamp: utc } };
}

/**
 * Writes the timestamps of the Statements of a request, and of their SubStatements, in UTC: an LRS converts a timestamp that is
 * not in UTC form and does not reject the Statement (4.2.7). A text that is no date and time is left as it is, for the reader of
 * Statements to refuse with its path.
 *
 * @returns The Statements, or the refusal of a timestamp with the offset `-00:00`.
 */
export function inUtcTimestamps(list: readonly unknown[]): Verdict<readonly unknown[]> {
  const converted: unknown[] = [];
  for (const [index, entry] of list.entries()) {
    if (!isRecord(entry)) {
      converted.push(entry);
      continue;
    }
    const statement = inUtc(entry, `[${index}].timestamp`);
    if (isRefusal(statement)) return statement;
    const { object } = statement.value;
    if (!isRecord(object) || object.objectType !== "SubStatement") {
      converted.push(statement.value);
      continue;
    }
    const sub = inUtc(object, `[${index}].object.timestamp`);
    if (isRefusal(sub)) return sub;
    converted.push({ ...statement.value, object: sub.value });
  }
  return { value: converted };
}
