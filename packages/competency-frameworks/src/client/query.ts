import { DataError } from "@interopkit/core";
import { checkArray, checkNonEmptyString, checkProperties, checkRecord, describe } from "@interopkit/core/checks";
import { type CaseFilter, FILTER_PREDICATES, SORT_ORDERS } from "../model/index.js";

/** A field of an entity, or a path through nested objects with dots: names of letters, digits and `_` that do not start with a digit. */
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/u;

/** The text that encloses a value in a filter (REST binding 3.3). The binding defines no way to write it inside a value. */
const QUOTE = "'";

/** A quote inside a value, written twice as the provider of this package reads it. */
const ESCAPED_QUOTE = "''";

const CONDITION_PROPERTIES = ["field", "predicate", "value"];

/** Checks a field name, such as the `sort` of a query or the `field` of a condition. */
function checkField(value: unknown, label: string): asserts value is string {
  checkNonEmptyString(value, label);
  if (!FIELD.test(value)) {
    throw new DataError(
      `${label} must be a field of the entity or a path of fields with dots, such as extensions.level, found ${describe(value)}.`,
    );
  }
}

/** Checks one comparison of a filter and writes it: the field, the predicate and the value in single quotes. */
function writeCondition(value: unknown, label: string): string {
  checkRecord(value, `${label} must be an object`);
  checkProperties(value, label, CONDITION_PROPERTIES);
  checkField(value.field, `The field of ${label.toLowerCase()}`);
  if (typeof value.predicate !== "string" || !(FILTER_PREDICATES as readonly string[]).includes(value.predicate)) {
    throw new DataError(
      `The predicate of ${label.toLowerCase()} must be one of ${FILTER_PREDICATES.join(" ")}, found ${describe(value.predicate)}.`,
    );
  }
  if (typeof value.value !== "string") {
    throw new DataError(`The value of ${label.toLowerCase()} must be a string, found ${describe(value.value)}.`);
  }
  return `${value.field}${value.predicate}${QUOTE}${value.value.replaceAll(QUOTE, ESCAPED_QUOTE)}${QUOTE}`;
}

/** Checks a filter and writes it: one comparison, or two joined by one logical operator. */
function writeFilter(filter: unknown, label: string): string {
  checkRecord(filter, `${label} must be an object`);
  const joiner = "and" in filter ? "and" : "or" in filter ? "or" : undefined;
  if (joiner === undefined) return writeCondition(filter, label);
  checkProperties(filter, label, [joiner]);
  const conditions = filter[joiner];
  checkArray(conditions, `The ${joiner} of ${label.toLowerCase()} must be a list of two comparisons`);
  if (conditions.length !== 2) {
    throw new DataError(
      `The ${joiner} of ${label.toLowerCase()} must have two comparisons, because the binding recommends one logical operator, found ${conditions.length}.`,
    );
  }
  return conditions
    .map((condition, at) => writeCondition(condition, `Comparison ${at + 1} of ${label.toLowerCase()}`))
    .join(` ${joiner.toUpperCase()} `);
}

/**
 * Writes the value of the `filter` parameter of a request for a collection.
 *
 * @remarks
 * A comparison is the field, the predicate and the value in single quotes, such as `version='1.0'`. Two comparisons are
 * joined with one `AND` or one `OR` between single spaces, which is all that the REST binding recommends. The binding gives
 * no way to write a single quote inside a value; a quote is written twice, as the provider of this package reads it, and for
 * a provider that reads it otherwise the value is cut at the quote and filtered with `~`. The text is not URL encoded: the
 * client does that when it builds the request.
 *
 * @param filter - A comparison, or an object with `and` or `or` and a list of two comparisons.
 * @returns The text, such as `version='1.0' AND lastChangeDateTime>'2016-12-12T00:00:00Z'`.
 * @throws `DataError` when the filter has another shape, a field that is not a field name or a path of them, a predicate
 * that is not one of `FILTER_PREDICATES`, or a value that is not a string.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1, REST binding 3.3}
 */
export function writeCaseFilter(filter: CaseFilter): string {
  return writeFilter(filter, "The filter");
}

/** Encodes a component of a query as RFC 3986 writes it: a space is `%20` and the marks `!'()*` are encoded too. */
function encode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/gu, (mark) => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The page of a request for a collection. */
export interface Page {
  readonly limit: number;
  readonly offset: number;
}

/** Checks the fields that a query selects and writes the value of the `fields` parameter: names separated by commas. */
function writeFields(fields: unknown): string {
  checkArray(fields, "The fields of the query must be a list of field names");
  if (fields.length === 0) throw new DataError("The fields of the query must name at least one field.");
  for (const [at, field] of fields.entries()) checkField(field, `The field ${at + 1} of the query`);
  return fields.map((field) => encode(String(field))).join(",");
}

/** Checks the direction of a sort. */
function checkOrder(order: unknown): asserts order is string {
  if (!(SORT_ORDERS as readonly unknown[]).includes(order)) {
    throw new DataError(`The orderBy of the query must be ${SORT_ORDERS.join(" or ")}, found ${describe(order)}.`);
  }
}

/** Checks a query of a request for a collection, as a host passes it from JavaScript, and writes the parameters. */
export function queryString(query: unknown, page: Page): string {
  const parameters: [string, string][] = [
    ["limit", String(page.limit)],
    ["offset", String(page.offset)],
  ];
  if (query !== undefined) {
    checkRecord(query, "The query must be an object");
    checkProperties(query, "The query", ["sort", "orderBy", "filter", "fields"]);
    if (query.sort !== undefined) {
      checkField(query.sort, "The sort of the query");
      parameters.push(["sort", encode(query.sort)]);
    }
    if (query.orderBy !== undefined) {
      checkOrder(query.orderBy);
      parameters.push(["orderBy", query.orderBy]);
    }
    if (query.filter !== undefined)
      parameters.push(["filter", encode(writeFilter(query.filter, "The filter of the query"))]);
    if (query.fields !== undefined) parameters.push(["fields", writeFields(query.fields)]);
  }
  return parameters.map(([name, value]) => `${name}=${value}`).join("&");
}
