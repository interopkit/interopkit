import { DataError } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import { refusal } from "../answers.js";
import type { PlatformSettings } from "../options.js";
import type { StorePage } from "../ports.js";
import type { RouteCall } from "./service.js";

/** The query parameter of a `next` link that carries where the page starts. */
const CURSOR = "cursor";

/** The page that a request asks for: its size, and where it starts. */
export interface PageRequest {
  /** The most items: the request's `limit`, else `pageSize`, at most `maxPageSize`. */
  readonly limit: number;
  /** Where the page starts, from the `next` link of the page before. */
  readonly cursor?: string;
}

/**
 * Reads the page that a request asks for: its `limit`, lowered to `maxPageSize`, and the `cursor` of a `next` link.
 *
 * @throws `DataError` when `cursor` is given more than once.
 */
function readPageRequest(url: URL, limit: number | undefined, settings: PlatformSettings): PageRequest {
  const cursors = url.searchParams.getAll(CURSOR);
  if (cursors.length > 1)
    throw new DataError(`The request must have the parameter cursor once, found ${cursors.length} times.`);
  const [cursor] = cursors;
  return {
    limit: Math.min(limit ?? settings.pageSize, settings.maxPageSize),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/**
 * Reads the filters of a request with the reader of its route, and the page that it asks for.
 *
 * @param read - Reads the filters and the `limit` of the query, and throws `DataError` for a query that is not one.
 * @returns The filters and the page, or the answer 400 `invalid_request` that names what is wrong.
 */
export function readPagedQuery<TQuery extends { readonly limit?: number | undefined }>(
  call: RouteCall,
  read: (search: URLSearchParams) => TQuery,
): { readonly query: TQuery; readonly page: PageRequest } | HttpResponse {
  try {
    const query = read(call.url.searchParams);
    return { query, page: readPageRequest(call.url, query.limit, call.settings) };
  } catch (error) {
    if (error instanceof DataError) return refusal(400, "invalid_request", error.message);
    throw error;
  }
}

/**
 * Checks the page that a store gave and returns the headers of the answer: a `Link` to the next page when the store says
 * where it starts (RFC 8288). The `next` URL is the request's with the `limit` and the `cursor` of the next page, so that it
 * carries every filter of the request, as AGS 3.2 asks: the tool uses it as it is.
 *
 * @param label - Names the method of the store in the error, such as `GradebookStore.lineItems`.
 * @throws `DataError` when the store gave more items than the limit.
 */
export function pageHeaders<T>(
  url: URL,
  page: StorePage<T>,
  asked: PageRequest,
  label: string,
): Record<string, string> {
  if (page.items.length > asked.limit) {
    throw new DataError(
      `The answer of ${label} has ${page.items.length} items for a limit of ${asked.limit}: it must return at most the limit.`,
    );
  }
  if (page.cursor === undefined) return {};
  const next = new URL(url);
  next.searchParams.set("limit", String(asked.limit));
  next.searchParams.set(CURSOR, page.cursor);
  return { link: `<${next.href}>; rel="next"` };
}
