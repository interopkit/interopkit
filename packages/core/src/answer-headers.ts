/** The most digits of a count or of a number of seconds in a header: more are not a count a client can use. */
const WHOLE_NUMBER = /^\d{1,15}$/u;

/** One value of a `Link` header (RFC 8288): the address in angle brackets and the parameters up to the next address. */
const LINK_VALUE = /<[^>]*>[^<]*/gu;

/** The `rel` parameter of a value of a `Link` header, quoted or not. */
const RELATION = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,"]+))/iu;

/**
 * Reads the count of a collection from `X-Total-Count`, which the REST bindings of CASE and Open Badges ask a server to send
 * when it knows the total.
 *
 * @param headers - The headers of the answer by name in lower case, as `ServiceResponse` and `ServiceError` give them.
 * @returns The count, or `undefined` when the header is absent or is not a count of at most 15 digits.
 */
export function totalCountOf(headers: Readonly<Record<string, string>>): number | undefined {
  const text = headers["x-total-count"]?.trim();
  return text !== undefined && WHOLE_NUMBER.test(text) ? Number(text) : undefined;
}

/**
 * Tells whether a `Link` header points to a next page.
 *
 * @remarks
 * The relation is read quoted or not, in any case, and among several (`rel="prev next"`). An address with commas or semicolons
 * in it does not end a value early. The address itself is never returned: a client that follows the address of a header could
 * be led anywhere, so it builds each request from its own base.
 *
 * @param headers - The headers of the answer by name in lower case.
 * @returns `undefined` when there is no `Link` header, otherwise whether one of its values has the relation `next`.
 * @see {@link https://www.rfc-editor.org/rfc/rfc8288 | RFC 8288, Web Linking}
 */
export function hasNextLink(headers: Readonly<Record<string, string>>): boolean | undefined {
  const link = headers.link;
  if (link === undefined) return undefined;
  return [...link.matchAll(LINK_VALUE)].some(([value]) => {
    const relation = RELATION.exec(value);
    const relations = (relation?.[1] ?? relation?.[2] ?? "").toLowerCase().split(/\s+/u);
    return relations.includes("next");
  });
}

/**
 * Reads how long a server asks a client to wait from `Retry-After`, when it gives a number of seconds.
 *
 * @remarks
 * The form that gives a date needs a clock, so it is not read: the header stays in `headers["retry-after"]` for a caller that
 * wants it. Nothing retries on its own: the host decides whether to wait.
 *
 * @param headers - The headers of the answer by name in lower case.
 * @returns The seconds, or `undefined` when the header is absent, gives a date, or is not a whole number of at most 15 digits.
 * @see {@link https://www.rfc-editor.org/rfc/rfc9110#field.retry-after | RFC 9110, Retry-After}
 */
export function retryAfterSeconds(headers: Readonly<Record<string, string>>): number | undefined {
  const delay = headers["retry-after"]?.trim();
  return delay !== undefined && WHOLE_NUMBER.test(delay) ? Number(delay) : undefined;
}
