import type { CasePage } from "./store.js";

const DIGITS = /^\d+$/u;

/** Reads a parameter that is a whole number from a minimum, or says why it is not one. */
function readWhole(
  parameters: ReadonlyMap<string, string>,
  name: string,
  minimum: number,
  fallback: number,
): number | string {
  const text = parameters.get(name);
  if (text === undefined) return fallback;
  const number = DIGITS.test(text) ? Number(text) : Number.NaN;
  if (Number.isSafeInteger(number) && number >= minimum) return number;
  return `The parameter ${name} must be a whole number of at least ${minimum}, found ${JSON.stringify(text)}.`;
}

/**
 * Reads `limit` and `offset` (REST binding 3.1). A `limit` above `maxPageSize` is lowered to it.
 *
 * @returns The page, or a sentence that names the parameter that is not a whole number in range.
 */
export function readPage(
  parameters: ReadonlyMap<string, string>,
  sizes: { readonly pageSize: number; readonly maxPageSize: number },
): CasePage | string {
  const limit = readWhole(parameters, "limit", 1, sizes.pageSize);
  if (typeof limit === "string") return limit;
  const offset = readWhole(parameters, "offset", 0, 0);
  if (typeof offset === "string") return offset;
  return { limit: Math.min(limit, sizes.maxPageSize), offset };
}

/** Builds the `Link` header of a page of the list (RFC 8288): the first and last pages, and the previous and next when there are any. */
export function pageLinks(url: string, page: CasePage, total: number): string {
  const link = (offset: number, relation: string): string => {
    const target = new URL(url);
    target.searchParams.set("limit", String(page.limit));
    target.searchParams.set("offset", String(offset));
    return `<${target.href}>; rel="${relation}"`;
  };
  const lastOffset = total === 0 ? 0 : Math.floor((total - 1) / page.limit) * page.limit;
  return [
    link(0, "first"),
    ...(page.offset > 0 ? [link(Math.max(0, page.offset - page.limit), "prev")] : []),
    ...(page.offset + page.limit < total ? [link(page.offset + page.limit, "next")] : []),
    link(lastOffset, "last"),
  ].join(", ");
}
