import { type Issue, isAbsoluteUri, isRecord, isUuid } from "@interopkit/core/checks";
import type { Statement } from "../model/index.js";
import { findInstant, parseIsoTimestamp } from "../model/internal.js";
import { error, item, member, warning } from "../read/internal.js";
import { SUBREGISTRATION_EXTENSION } from "./profile.js";

/** The Statements of one registration, and of one subregistration of the profile when they have one, in the order to match. */
export interface Series {
  readonly registration: string;
  readonly subregistration?: string;
  /** The places of the Statements in the list, by timestamp and, at one time, by place. */
  readonly indexes: readonly number[];
}

/** A variant 2 UUID of RFC 4122: the first hexadecimal digit of its fourth group is 8, 9, a or b. */
const VARIANT_2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Reads one entry of the subregistration extension: its profile and its subregistration, or `undefined` for another form. */
function entryOf(entry: unknown): { readonly profile: string; readonly subregistration: string } | undefined {
  if (!isRecord(entry)) return undefined;
  const { profile, subregistration } = entry;
  if (typeof profile !== "string" || !isAbsoluteUri(profile)) return undefined;
  if (typeof subregistration !== "string" || !isUuid(subregistration) || !VARIANT_2.test(subregistration))
    return undefined;
  return { profile, subregistration: subregistration.toLowerCase() };
}

/** Returns the subregistration of a Statement for a version of a profile, with what is wrong with its extension. */
function subregistrationOf(
  statement: Statement,
  version: string,
  path: string,
): { readonly id?: string; readonly issues: readonly Issue[] } {
  const value = statement.context?.extensions?.[SUBREGISTRATION_EXTENSION];
  if (value === undefined) return { issues: [] };
  const at = member(member(member(path, "context"), "extensions"), SUBREGISTRATION_EXTENSION);
  if (statement.context?.registration === undefined) {
    return { issues: [error(at, "subregistration-registration", "expected a registration beside a subregistration.")] };
  }
  const entries = Array.isArray(value) ? value : [];
  if (entries.length === 0) {
    const form = "expected a non-empty array of objects with profile and subregistration.";
    return { issues: [error(at, "subregistration-form", form)] };
  }
  const category = new Set((statement.context.contextActivities?.category ?? []).map(({ id }) => id));
  const issues: Issue[] = [];
  let id: string | undefined;
  for (const [index, value] of entries.entries()) {
    const entry = entryOf(value);
    if (entry === undefined) {
      const form = "expected an object with profile, an IRI, and subregistration, a variant 2 UUID.";
      issues.push(error(item(at, index), "subregistration-form", form));
    } else if (!category.has(entry.profile)) {
      const profile = `expected a profile version among the category Activities, found ${JSON.stringify(entry.profile)}.`;
      issues.push(error(item(at, index), "subregistration-profile", profile));
    } else if (entry.profile === version) {
      id = entry.subregistration;
    }
  }
  return id === undefined ? { issues } : { id, issues };
}

/** A Statement of the list, with its place. */
export interface PlacedStatement {
  readonly index: number;
  readonly statement: Statement;
}

/** Reads the time of a Statement in either version's form. */
function timeOf(statement: Statement): number | undefined {
  const { timestamp } = statement;
  return timestamp === undefined ? undefined : (parseIsoTimestamp(timestamp) ?? findInstant(timestamp));
}

/**
 * Orders the Statements of a series by time, a Statement without one where it stands, and at one time by place, and lists those
 * whose own time another Statement of the series has.
 */
function ordered(entries: readonly PlacedStatement[]): { readonly indexes: number[]; readonly repeated: number[] } {
  let previous = Number.NEGATIVE_INFINITY;
  const timed = entries.map(({ index, statement }) => {
    const own = timeOf(statement);
    previous = own ?? previous;
    return { index, time: previous, own };
  });
  timed.sort((left, right) => left.time - right.time || left.index - right.index);
  const seen = new Set<number>();
  const repeated: number[] = [];
  for (const { index, own } of timed) {
    if (own === undefined) continue;
    if (seen.has(own)) repeated.push(index);
    seen.add(own);
  }
  return { indexes: timed.map(({ index }) => index), repeated };
}

/**
 * Groups the Statements that name a version of a profile by their registration, and by their subregistration of that version
 * when they have one, and lists what breaks the rules of registrations: a subregistration without a registration or of the
 * wrong form, a Statement without a registration where the profile has primary Patterns, and two Statements of a series at one
 * time.
 */
export function groupRegistrations(
  entries: readonly PlacedStatement[],
  version: string,
  needsRegistration: boolean,
): { readonly series: readonly Series[]; readonly issues: readonly Issue[] } {
  const issues: Issue[] = [];
  const groups = new Map<
    string,
    { readonly registration: string; readonly subregistration?: string; readonly entries: PlacedStatement[] }
  >();
  for (const entry of entries) {
    const path = item("", entry.index);
    const subregistration = subregistrationOf(entry.statement, version, path);
    for (const issue of subregistration.issues) issues.push(issue);
    const registration = entry.statement.context?.registration;
    if (registration === undefined) {
      if (needsRegistration) {
        issues.push(
          error(
            path,
            "registration-missing",
            "expected a registration on a Statement that follows a primary Pattern of the profile.",
          ),
        );
      }
      continue;
    }
    const key = `${registration.toLowerCase()} ${subregistration.id ?? ""}`;
    const group = groups.get(key) ?? {
      registration,
      ...(subregistration.id === undefined ? {} : { subregistration: subregistration.id }),
      entries: [],
    };
    groups.set(key, group);
    group.entries.push(entry);
  }
  const series: Series[] = [];
  for (const { entries: members, ...group } of groups.values()) {
    const { indexes, repeated } = ordered(members);
    series.push({ ...group, indexes });
    for (const index of repeated) {
      issues.push(
        warning(
          item("", index),
          "timestamp-repeated",
          "expected a timestamp that no other Statement of the series has, so that their order is the order of time.",
        ),
      );
    }
  }
  return { series, issues };
}
