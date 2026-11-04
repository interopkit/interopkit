import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { type CaseCondition, type CaseFilter, type CaseQuery, type CaseVersion, SORT_ORDERS } from "../model/index.js";
import { isDocumentField, isDocumentPath } from "./fields.js";
import { parseFilterText } from "./filter-text.js";

/** A query that `parseCaseQuery` has read, and the collation that sorting and filtering use. */
export interface ParsedCaseQuery extends CaseQuery {
  /**
   * The locale of the Unicode collation for `sort` and `filter`, as a BCP 47 tag. The provider sets it from its option.
   *
   * @defaultValue `"und"`
   */
  readonly collation?: string;
}

/** The code of the answer to a query that could not be used, as the REST binding writes it (3.4). */
type QueryRefusalReason = "invalid_filter_field" | "invalid_selection_field";

/** Why a query could not be used, and the code that the REST binding gives the answer. */
interface QueryRefusal {
  /** The code of the answer: a filter that cannot be read or names an unknown field, or a blank name in `fields`. */
  readonly reason: QueryRefusalReason;
  /** A sentence that says what is wrong and what to write. */
  readonly message: string;
}

const FIELD_SEPARATOR = ",";

/**
 * The most characters of a `fields` list, as of a filter, so that a request cannot make the reader split an unbounded text: the
 * names of every property of a CFDocument take about 250.
 */
const MAX_FIELDS_LENGTH = 2048;

/** Lists the conditions of a filter. */
function conditionsOf(filter: CaseFilter): readonly CaseCondition[] {
  if ("and" in filter) return filter.and;
  if ("or" in filter) return filter.or;
  return [filter];
}

/** Reads a filter, and checks that it names data of a CFDocument. */
function readFilter(text: string, version: CaseVersion): CaseFilter | QueryRefusal {
  const filter = parseFilterText(text);
  if ("detail" in filter) return { reason: "invalid_filter_field", message: filter.detail };
  const unknown = conditionsOf(filter).find((condition) => !isDocumentPath(version, condition.field));
  return unknown === undefined
    ? filter
    : {
        reason: "invalid_filter_field",
        message: `The filter names the field "${unknown.field}", which a CFDocument of CASE ${version} does not have.`,
      };
}

/**
 * Reads the list of `fields`: a blank name is refused, and a name that a CFDocument does not have is left out. The list is
 * empty when no name is one, and then the answer holds every field.
 */
function readSelection(text: string, version: CaseVersion): readonly string[] | QueryRefusal {
  if (text.length > MAX_FIELDS_LENGTH) {
    return {
      reason: "invalid_selection_field",
      message: `The fields list has ${text.length} characters; the most is ${MAX_FIELDS_LENGTH}.`,
    };
  }
  const names = text.split(FIELD_SEPARATOR).map((name) => name.trim());
  if (names.includes("")) {
    return {
      reason: "invalid_selection_field",
      message: "The fields list has a blank name: write the names with a comma between them, such as identifier,title.",
    };
  }
  return [...new Set(names.filter((name) => isDocumentField(version, name)))];
}

/** Reads the parameters of a request for the list of documents, for the properties that a CFDocument has in a version. */
export function parseQuery(
  parameters: ReadonlyMap<string, string>,
  version: CaseVersion,
): ParsedCaseQuery | QueryRefusal {
  const query: { -readonly [TKey in keyof ParsedCaseQuery]: ParsedCaseQuery[TKey] } = {};
  const filterText = parameters.get("filter");
  if (filterText !== undefined) {
    const filter = readFilter(filterText, version);
    if ("reason" in filter) return filter;
    query.filter = filter;
  }
  const fieldsText = parameters.get("fields");
  if (fieldsText !== undefined) {
    const fields = readSelection(fieldsText, version);
    if ("reason" in fields) return fields;
    if (fields.length > 0) query.fields = fields;
  }
  const sort = parameters.get("sort");
  // A field that does not exist leaves the provider's order, and so does a direction that is not one.
  if (sort !== undefined && isDocumentPath(version, sort)) {
    query.sort = sort;
    const orderBy = SORT_ORDERS.find((order) => order === parameters.get("orderBy"));
    if (orderBy !== undefined) query.orderBy = orderBy;
  }
  return query;
}

/**
 * Reads the query parameters of a request for the list of documents (REST binding 3.2 to 3.4): `sort` with `orderBy`,
 * `filter` and `fields`.
 *
 * @remarks
 * A filter that cannot be read, that names a property a CFDocument does not have, or that has more than one `AND` or `OR`
 * is refused with `invalid_filter_field`; a `fields` list with a blank name is refused with `invalid_selection_field`. A
 * name in `fields` that is not a property is left out, and the list is left out when no name is one. A `sort` that names no
 * property, and an `orderBy` that is not `asc` or `desc`, are left out, so that the provider's order stands. The names are
 * those of a CFDocument of CASE 1.1; the provider holds its 1.0 path to the names of 1.0. Only the first name of a path
 * such as `licenseURI.title` is checked, because the binding types nested properties loosely.
 *
 * @param parameters - The parameters of the query by name, such as `readQuery` of `@interopkit/core/http` returns.
 * @returns The query to hand to a store, or the refusal and its code.
 * @throws `DataError` when the parameters are not a map of strings.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/case/v1p1/rest_binding/caseservicev1p1_restbindv1p0.html | CASE REST binding 1.0, section 3}
 */
export function parseCaseQuery(parameters: ReadonlyMap<string, string>): ParsedCaseQuery | QueryRefusal {
  if (!(parameters instanceof Map)) {
    throw new DataError(`The parameters must be a Map of strings, found ${describe(parameters)}.`);
  }
  for (const [name, value] of parameters) {
    if (typeof value !== "string") {
      throw new DataError(`The parameter ${describe(name)} must be a string, found ${describe(value)}.`);
    }
  }
  return parseQuery(parameters, "1.1");
}
