import { DataError } from "@interopkit/core";
import { checkArray, checkRecord, parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { type CaseCondition, type CaseFilter, FILTER_PREDICATES, SORT_ORDERS } from "../model/index.js";
import type { ParsedCaseQuery } from "./parse-query.js";
import { type Found, likeValue, order, type Scalar, valuesAt } from "./values.js";

/** The root locale of CLDR, the collation that a provider uses unless it is told another. */
export const DEFAULT_COLLATION = "und";
const LIST_SEPARATOR = ",";

/** The options of `queryEntities`. */
export interface QueryEntitiesOptions {
  /**
   * The locale of the Unicode collation for `sort` and `filter`, as a BCP 47 tag. It wins over the `collation` of the query.
   *
   * @defaultValue the `collation` of the query, and `"und"` when it has none
   */
  readonly collation?: string;
}

/** How a filter compares text: the collator that ignores case and keeps accents, and the locale that lower-cases for `~`. */
interface Comparer {
  readonly match: Intl.Collator;
  readonly locale: string;
}

const text = v.string();
const condition = strictRecord({ field: text, predicate: v.picklist(FILTER_PREDICATES), value: text });
const pair = v.strictTuple([condition, condition]);
const filterSchema = v.union([condition, strictRecord({ and: pair }), strictRecord({ or: pair })]);
const querySchema = strictRecord({
  sort: v.optional(text),
  orderBy: v.optional(v.picklist(SORT_ORDERS)),
  filter: v.optional(filterSchema),
  fields: v.optional(v.array(text)),
  collation: v.optional(text),
});
const optionsSchema = strictRecord({ collation: v.optional(text) });

/** Returns the canonical form of a BCP 47 language tag, or `undefined` when the text is not a well-formed tag. */
export function canonicalLocale(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    // `getCanonicalLocales` throws a `RangeError` for a malformed tag.
    return undefined;
  }
}

/**
 * Returns the canonical form of a BCP 47 language tag.
 *
 * @throws `DataError` that names the label when the text is not a well-formed tag.
 */
function readLocale(tag: string, label: string): string {
  const canonical = canonicalLocale(tag);
  if (canonical === undefined) {
    throw new DataError(
      `${label} must be a BCP 47 language tag such as "und" or "sv-SE", found ${JSON.stringify(tag)}.`,
    );
  }
  return canonical;
}

/** The text of a value as `~` compares it: in canonical form and in lower case for the locale. */
const fold = (value: string, locale: string): string => value.normalize("NFC").toLocaleLowerCase(locale);

/** Splits the value of a filter on a list into its terms. */
const termsOf = (value: string): string[] => value.split(LIST_SEPARATOR).map((term) => term.trim());

/** Tells whether the value of a condition equals what a path found, as one value or as the whole list. */
function equals(found: Found, value: string, { match }: Comparer): boolean {
  const same = (candidate: Scalar, term: string): boolean => order(candidate, likeValue(term, candidate), match) === 0;
  if (!found.several) return found.values.some((candidate) => same(candidate, value));
  const terms = termsOf(value);
  return (
    found.values.length > 0 &&
    found.values.every((candidate) => terms.some((term) => same(candidate, term))) &&
    terms.every((term) => found.values.some((candidate) => same(candidate, term)))
  );
}

/** Tells whether any of the terms of the value is in any of the values that a path found. */
function contains(found: Found, value: string, { locale }: Comparer): boolean {
  const terms = (found.several ? termsOf(value) : [value]).map((term) => fold(term, locale));
  return found.values.some((candidate) => terms.some((term) => fold(String(candidate), locale).includes(term)));
}

/** Tells whether an entity satisfies a condition. */
function satisfies(entity: object, { field, predicate, value }: CaseCondition, comparer: Comparer): boolean {
  const found = valuesAt(entity, field);
  const compare = (candidate: Scalar): number => order(candidate, likeValue(value, candidate), comparer.match);
  switch (predicate) {
    case "=":
      return equals(found, value, comparer);
    case "!=":
      return !equals(found, value, comparer);
    case "~":
      return contains(found, value, comparer);
    case ">":
      return found.values.some((candidate) => compare(candidate) > 0);
    case ">=":
      return found.values.some((candidate) => compare(candidate) >= 0);
    case "<":
      return found.values.some((candidate) => compare(candidate) < 0);
    case "<=":
      return found.values.some((candidate) => compare(candidate) <= 0);
  }
}

/** Tells whether an entity passes a filter. */
function passes(entity: object, filter: CaseFilter, comparer: Comparer): boolean {
  if ("and" in filter) return filter.and.every((each) => satisfies(entity, each, comparer));
  if ("or" in filter) return filter.or.some((each) => satisfies(entity, each, comparer));
  return satisfies(entity, filter, comparer);
}

/**
 * Filters and sorts entities in memory as the REST binding describes (3.2 and 3.3), for a store that holds its documents in
 * a list.
 *
 * @remarks
 * Text is compared without regard to case and with regard to accents, by the Unicode collation of the locale. `~` looks for
 * the value in the text after both are converted to lower case in the locale, because the language has no search that uses
 * a collation. A number is compared as a number when the value reads as one, and date-times of RFC 3339 by the instant they
 * name. When the path crosses a list, `=` and `!=` compare the whole list with the comma-separated values of the filter as
 * sets, `~` looks for any of them in any member, and the other predicates ask for one member that satisfies them. `!=` is
 * true for an entity with no value at the path. `sort` takes the first value at its path; entities without one come last in
 * either direction, and entities that compare equal keep their order. The fields of the query are not applied. The result
 * holds the entities themselves, not copies.
 *
 * @typeParam T - The type of the entities.
 * @param entities - The entities, such as the documents of a store.
 * @param query - What `parseCaseQuery` returns, or a query written by hand.
 * @param options - The collation.
 * @returns The entities that pass the filter, in the order of the sort, or in their own order when there is none.
 * @throws `DataError` when the entities are not a list of objects, when the query or the options are not of the types
 * `ParsedCaseQuery` and `QueryEntitiesOptions` give, or when the collation is not a BCP 47 language tag.
 */
export function queryEntities<T extends object>(
  entities: readonly T[],
  query: ParsedCaseQuery,
  options?: QueryEntitiesOptions,
): readonly T[] {
  checkArray(entities, "The entities must be an array");
  for (const [index, entity] of entities.entries()) checkRecord(entity, `The entity at ${index} must be an object`);
  const { filter, sort, orderBy, collation } = parseWith(querySchema, query, "The query");
  const settings = parseWith(optionsSchema, options === undefined ? {} : options, "The options");
  const locale = readLocale(settings.collation ?? collation ?? DEFAULT_COLLATION, "The collation");
  const comparer = { match: new Intl.Collator(locale, { sensitivity: "accent" }), locale };
  const kept = filter === undefined ? [...entities] : entities.filter((entity) => passes(entity, filter, comparer));
  if (sort === undefined) return kept;
  const collator = new Intl.Collator(locale);
  const direction = orderBy === "desc" ? -1 : 1;
  const keyed = kept.map((entity) => ({ entity, key: valuesAt(entity, sort).values[0] }));
  keyed.sort((left, right) => {
    if (left.key === undefined) return right.key === undefined ? 0 : 1;
    if (right.key === undefined) return -1;
    return direction * order(left.key, right.key, collator);
  });
  return keyed.map(({ entity }) => entity);
}
