/** The most digits of a count in a header: a count of a collection fits a safe integer long before. */
const COUNT = /^\d{1,15}$/u;

/** One value of a `Link` header (RFC 8288): the address in angle brackets and the parameters up to the next address. */
const LINK_VALUE = /<[^>]*>[^<]*/gu;

/** The `rel` parameter of a value of a `Link` header, quoted or not. */
const RELATION = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,"]+))/iu;

/**
 * Reads the count of a collection from `X-Total-Count`, which a server includes when it knows the total (OB 6.4).
 *
 * @param headers - The headers of the answer by name in lower case.
 * @returns The count, or `undefined` when the header is absent or is not a count.
 */
export function totalCountOf(headers: Readonly<Record<string, string>>): number | undefined {
  const text = headers["x-total-count"]?.trim();
  return text !== undefined && COUNT.test(text) ? Number(text) : undefined;
}

/**
 * Tells whether a `Link` header points to a next page.
 *
 * @param headers - The headers of the answer by name in lower case.
 * @returns `undefined` when there is no `Link` header, otherwise whether one of its values has the relation `next`.
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
