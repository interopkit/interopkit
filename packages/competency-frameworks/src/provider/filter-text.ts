import { type CaseCondition, type CaseFilter, FILTER_PREDICATES } from "../model/index.js";

/** The most characters of a filter, so that a request cannot make the parser work on an unbounded text. */
const MAX_FILTER_LENGTH = 2048;

/** Why a filter could not be read. */
export interface FilterRefusal {
  /** A sentence that says what is wrong with the filter and what to write. */
  readonly detail: string;
}

/** The predicates, the longest first so that `>=` is not read as `>`. */
const PREDICATES = [...FILTER_PREDICATES].sort((left, right) => right.length - left.length);
const PREDICATE_LIST = FILTER_PREDICATES.join(" ");
const FIELD = /^[^\s=!<>~']+/u;
const QUOTE = "'";

const refuse = (detail: string): FilterRefusal => ({ detail });

/** Matches `AND` or `OR` between white space, or at the end of the text, starting exactly at an index. */
function logicalAt(text: string, index: number): RegExpExecArray | null {
  const logical = /\s+(AND|OR)(?:\s+|$)/iuy;
  logical.lastIndex = index;
  return logical.exec(text);
}

/** Returns the index of the first character at or after an index that is not white space. */
function skipSpace(text: string, index: number): number {
  let end = index;
  while (end < text.length && /\s/u.test(text.charAt(end))) end += 1;
  return end;
}

/**
 * Finds the quote that closes a value: reading from the start of the value, two quotes together are one quote of the value,
 * and a single quote closes the value when it ends the text or is followed by `AND` or `OR`. Any other single quote is an
 * apostrophe of the value.
 */
function closingQuote(text: string, from: number): number {
  let index = text.indexOf(QUOTE, from);
  while (index !== -1) {
    if (text[index + 1] === QUOTE) index = text.indexOf(QUOTE, index + 2);
    else if (index === text.length - 1 || logicalAt(text, index + 1) !== null) return index;
    else index = text.indexOf(QUOTE, index + 1);
  }
  return -1;
}

/** Reads one condition that starts at an index, and says where it ends. */
function readCondition(text: string, start: number): { condition: CaseCondition; end: number } | FilterRefusal {
  const field = FIELD.exec(text.slice(start))?.[0];
  if (field === undefined) return refuse(`The filter needs a field name at character ${start + 1}.`);
  const operator = skipSpace(text, start + field.length);
  const predicate = PREDICATES.find((each) => text.startsWith(each, operator));
  if (predicate === undefined) {
    return refuse(`The filter has no predicate after the field "${field}": write one of ${PREDICATE_LIST}.`);
  }
  const opening = skipSpace(text, operator + predicate.length);
  if (text[opening] !== QUOTE) {
    return refuse(`The value of the field "${field}" must be in single quotes, such as ${field}${predicate}'text'.`);
  }
  const closing = closingQuote(text, opening + 1);
  if (closing === -1) {
    return refuse(`The value of the field "${field}" has no closing single quote at the end or before AND or OR.`);
  }
  const value = text.slice(opening + 1, closing).replaceAll("''", QUOTE);
  return { condition: { field, predicate, value }, end: closing + 1 };
}

/**
 * Reads the text of a `filter` parameter (REST binding 3.3): `field<predicate>'value'`, and optionally one `AND` or `OR`
 * with a second condition. The text is already URL decoded.
 *
 * @remarks
 * A value is in single quotes. A quote inside a value is written twice, and a single quote that neither ends the filter nor
 * is followed by `AND` or `OR` is read as an apostrophe. A value may hold the words `AND` and `OR`. `AND` and `OR` may be in
 * either case.
 */
export function parseFilterText(text: string): CaseFilter | FilterRefusal {
  if (text.length > MAX_FILTER_LENGTH) {
    return refuse(`The filter has ${text.length} characters; the most is ${MAX_FILTER_LENGTH}.`);
  }
  if (text.trim() === "")
    return refuse("The filter is empty: write a field, a predicate and a value in single quotes.");
  const first = readCondition(text, 0);
  if ("detail" in first) return first;
  const logical = logicalAt(text, first.end);
  // A condition ends the text or is followed by `AND` or `OR`, because only such a quote closes a value.
  if (logical === null) return first.condition;
  const second = readCondition(text, first.end + logical[0].length);
  if ("detail" in second) return second;
  if (logicalAt(text, second.end) !== null) {
    return refuse("The filter has more than one logical operator: use at most one AND or OR.");
  }
  const pair = [first.condition, second.condition] as const;
  return /^\s+and/iu.test(logical[0]) ? { and: pair } : { or: pair };
}
