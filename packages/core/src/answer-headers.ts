import { checkHttpsUrl, checkNonEmptyString } from "./checks.js";

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

/** Returns the targets of the values of a `Link` header that have the relation, in order, as the header writes them. */
function targetsOf(link: string, relation: string): string[] {
  const wanted = relation.toLowerCase();
  return [...link.matchAll(LINK_VALUE)].flatMap(([value]) => {
    const end = value.indexOf(">");
    // The parameters follow the address, so a `rel=` inside the address is not one.
    const match = RELATION.exec(value.slice(end + 1));
    const relations = (match?.[1] ?? match?.[2] ?? "").toLowerCase().split(/\s+/u);
    return relations.includes(wanted) ? [value.slice(1, end)] : [];
  });
}

/**
 * Tells whether a `Link` header points to a next page.
 *
 * @remarks
 * The relation is read quoted or not, in any case, and among several (`rel="prev next"`). An address with commas or semicolons
 * in it does not end a value early. Only whether a next page exists is answered: `linkTarget` gives the address, and only on
 * the origin of the request.
 *
 * @param headers - The headers of the answer by name in lower case.
 * @returns `undefined` when there is no `Link` header, otherwise whether one of its values has the relation `next`.
 * @see {@link https://www.rfc-editor.org/rfc/rfc8288 | RFC 8288, Web Linking}
 */
export function hasNextLink(headers: Readonly<Record<string, string>>): boolean | undefined {
  const link = headers.link;
  return link === undefined ? undefined : targetsOf(link, "next").length > 0;
}

/**
 * Tells whether a server has more items of a collection after a page of a list that it pages by `limit` and `offset`, as the REST
 * bindings of CASE and Open Badges do.
 *
 * @remarks
 * `X-Total-Count` decides when it is a count: more follow while the offset is below it. Without it, the `Link` header decides
 * by a value with the relation `next`. Without either, more may follow when the page is as long as the request asked for, so a
 * short page ends the list.
 *
 * @param headers - The headers of the answer by name in lower case.
 * @param offset - The offset after the page: the items of the pages so far.
 * @param received - The items of the page.
 * @param limit - The items that the request asked for.
 * @returns Whether a next page may hold more items.
 */
export function hasNextPage(
  headers: Readonly<Record<string, string>>,
  offset: number,
  received: number,
  limit: number,
): boolean {
  const total = totalCountOf(headers);
  if (total !== undefined) return offset < total;
  return hasNextLink(headers) ?? received >= limit;
}

/**
 * Returns the address that a `Link` header gives for a relation, such as the `next` page of a collection, when it lies on the
 * origin of the request.
 *
 * @remarks
 * The first value with the relation decides. Its address is resolved against the request's, since a link may be relative
 * (RFC 8288 section 3.1), and is returned only when it is `https`, on the origin of the request and without user information.
 * A client that sends a bearer token with each page so never sends it to another server, whatever the answer says. The
 * relation is compared in any case (RFC 8288 section 2.1.1).
 *
 * @param headers - The headers of the answer by name in lower case.
 * @param relation - The relation, such as `next` or `differences`.
 * @param requestUrl - The address of the request that the answer answers, an `https` URL.
 * @returns The absolute address, or `undefined` when there is no `Link` header, no value with the relation, or the first
 * such value is not an address on the origin of the request.
 * @throws `DataError` when the relation is not a non-empty string or the request URL is not an absolute `https` URL.
 * @see {@link https://www.rfc-editor.org/rfc/rfc8288 | RFC 8288, Web Linking}
 */
export function linkTarget(
  headers: Readonly<Record<string, string>>,
  relation: string,
  requestUrl: string,
): string | undefined {
  checkNonEmptyString(relation, "The relation");
  checkHttpsUrl(requestUrl, "The request URL");
  const link = headers.link;
  const [target] = link === undefined ? [] : targetsOf(link, relation);
  if (target === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(target, requestUrl);
  } catch {
    // An address that does not parse leads nowhere.
    return undefined;
  }
  const sameOrigin = url.protocol === "https:" && url.origin === new URL(requestUrl).origin;
  return sameOrigin && url.username === "" && url.password === "" ? url.href : undefined;
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
