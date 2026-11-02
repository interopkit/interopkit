import { checkNonNegativeInteger, checkPositiveInteger, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";

/** The slice of a list that a request asks for: at most `limit` items, after the first `offset`. */
export interface OffsetPage {
  /** The most items to return, at least 1. */
  readonly limit: number;
  /** The number of items to skip, from 0. */
  readonly offset: number;
}

/** The sizes of a page that a handler serves. */
export interface PageSizes {
  /** The items of a page when the request has no `limit`; a size above `maxPageSize` is lowered to it. */
  readonly pageSize: number;
  /** The most items of a page; a larger `limit` is lowered to it. */
  readonly maxPageSize: number;
}

/**
 * What a handler knows of the length of a list: the number of items, or only whether items follow the page, when the store
 * cannot count them.
 */
export type ListExtent =
  | {
      /** The number of items in the list, whatever the page. */
      readonly total: number;
    }
  | {
      /** Whether items may follow the page. */
      readonly more: boolean;
    };

/** The text of a whole number in a query: digits only, so that `1e3`, `0x10` and ` 5` are not numbers. */
const DIGITS = /^\d+$/u;

/** Reads a parameter that is a whole number from a minimum, or the fallback when the query has none. */
function readWhole(parameters: ReadonlyMap<string, string>, name: string, minimum: number, fallback: number): number {
  const text = parameters.get(name);
  if (text === undefined) return fallback;
  const number = DIGITS.test(text) ? Number(text) : Number.NaN;
  if (Number.isSafeInteger(number) && number >= minimum) return number;
  throw new DataError(`The parameter ${name} must be a whole number of at least ${minimum}, found ${describe(text)}.`);
}

/**
 * Reads the page that a query asks for from its `limit` and `offset`, the paging of the REST bindings of 1EdTech.
 *
 * @remarks
 * `limit` is a whole number of at least 1 and `offset` one of at least 0, written in digits. Without a `limit` the page holds
 * `pageSize` items, without an `offset` it starts at the first, and a `limit` above `maxPageSize` is lowered to it.
 *
 * @param parameters - The parameters of the query, such as `readQuery` reads them.
 * @param sizes - The page size of the handler and its largest page.
 * @returns The page.
 * @throws `DataError` that names the parameter, when `limit` or `offset` is not a whole number in range, or when the arguments
 * are not a map and positive whole sizes.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#paging | Open Badges 3.0, Paging}
 */
export function readOffsetPage(parameters: ReadonlyMap<string, string>, sizes: PageSizes): OffsetPage {
  if (!(parameters instanceof Map)) {
    throw new DataError(`The parameters must be a Map of names to values, found ${describe(parameters)}.`);
  }
  checkRecord(sizes, "The sizes of a page must be an object");
  checkPositiveInteger(sizes.pageSize, "The pageSize");
  checkPositiveInteger(sizes.maxPageSize, "The maxPageSize");
  const limit = readWhole(parameters, "limit", 1, sizes.pageSize);
  const offset = readWhole(parameters, "offset", 0, 0);
  return { limit: Math.min(limit, sizes.maxPageSize), offset };
}

/**
 * Builds the `Link` header of a page of a list (RFC 8288): the first page, the previous one when the page does not start the
 * list, the next one when items follow, and the last one when the total is known.
 *
 * @remarks
 * Each address is the URL of the request with its `limit` and `offset` set, so that it keeps the other parameters of the
 * query. The last page starts at the last multiple of `limit` below the total, and is the first page of an empty list.
 *
 * @param url - The absolute URL of the request, as the client used it.
 * @param page - The page that the answer holds.
 * @param extent - The number of items in the list, or whether more follow when the store cannot count them.
 * @returns The value of the header.
 * @throws `DataError` when the URL is not absolute or the page or the extent is not whole numbers.
 * @see {@link https://www.rfc-editor.org/rfc/rfc8288 | RFC 8288, Web Linking}
 */
export function offsetPageLinks(url: string, page: OffsetPage, extent: ListExtent): string {
  checkString(url, "The URL");
  if (!URL.canParse(url)) throw new DataError(`The URL must be an absolute URL, found ${describe(url)}.`);
  checkRecord(page, "The page must be an object");
  checkPositiveInteger(page.limit, "The limit of the page");
  checkNonNegativeInteger(page.offset, "The offset of the page");
  checkRecord(extent, "The extent of the list must be an object");
  const link = (offset: number, relation: string): string => {
    const target = new URL(url);
    target.searchParams.set("limit", String(page.limit));
    target.searchParams.set("offset", String(offset));
    return `<${target.href}>; rel="${relation}"`;
  };
  const links = [link(0, "first")];
  if (page.offset > 0) links.push(link(Math.max(0, page.offset - page.limit), "prev"));
  if ("total" in extent) {
    checkNonNegativeInteger(extent.total, "The total of the list");
    if (page.offset + page.limit < extent.total) links.push(link(page.offset + page.limit, "next"));
    const lastOffset = extent.total === 0 ? 0 : Math.floor((extent.total - 1) / page.limit) * page.limit;
    links.push(link(lastOffset, "last"));
  } else if (extent.more === true) {
    links.push(link(page.offset + page.limit, "next"));
  } else if (extent.more !== false) {
    throw new DataError(`The extent of the list must have a whole total or a boolean more, found ${describe(extent)}.`);
  }
  return links.join(", ");
}
