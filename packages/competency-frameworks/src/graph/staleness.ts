import { DataError } from "@interopkit/core";
import { checkRecord, describe, parseDateTime } from "@interopkit/core/checks";

/** Reads the `lastChangeDateTime` of an entity into milliseconds. */
function changedAt(entity: unknown, label: string): number {
  checkRecord(entity, `${label} must be an object`);
  const text = entity.lastChangeDateTime;
  const time = typeof text === "string" ? parseDateTime(text) : undefined;
  if (time === undefined) {
    throw new DataError(
      `The lastChangeDateTime of ${label.toLowerCase()} must be a date and time of RFC 3339 with an offset, found ${describe(text)}.`,
    );
  }
  return time;
}

/**
 * Tells whether a copy of an entity is out of date: the entity at its source of truth was changed after the copy.
 *
 * @remarks
 * The times are compared as instants and not as text, so `2024-06-13T18:46:03+00:00` and `2024-06-13T20:46:03+02:00` are the
 * same. An entity changed at the same instant is not newer. The `uri` of an entity is the address of its source of truth, and
 * the `lastChangeDateTime` of a document changes whenever anything in its framework does, so a consumer asks for the document
 * of a framework and fetches the package only when this returns `true`.
 *
 * @param cached - The copy that the consumer holds: any entity with a `lastChangeDateTime`.
 * @param current - The entity as the source of truth gives it now.
 * @returns `true` when `current` was changed after `cached`.
 * @throws `DataError` when either has no `lastChangeDateTime` that is a date and time of RFC 3339 with an offset.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1/impl | CASE Implementation Guide}, 4.1 and 4.10
 */
export function isNewer(
  cached: { readonly lastChangeDateTime: string },
  current: { readonly lastChangeDateTime: string },
): boolean {
  return changedAt(current, "The current entity") > changedAt(cached, "The cached entity");
}
