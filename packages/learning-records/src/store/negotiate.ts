/** A media range of an `Accept` header with its weight. */
interface MediaRange {
  readonly type: string;
  readonly subtype: string;
  readonly quality: number;
}

const TOKEN = /^[a-z0-9!#$%&'*+.^_`|~-]+$/u;
/** RFC 9110 section 12.4.2: `0` or `1` with up to three digits, and nothing above 1. */
const QUALITY = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u;
const WILDCARD = "*";

/** Reads one media range, or returns `undefined` for an entry that is not one, so that a malformed entry accepts nothing. */
function readRange(entry: string): MediaRange | undefined {
  const [media = "", ...parameters] = entry.split(";");
  const [type = "", subtype = "", ...rest] = media.trim().toLowerCase().split("/");
  if (rest.length > 0 || !TOKEN.test(type) || !TOKEN.test(subtype)) return undefined;
  if (type === WILDCARD && subtype !== WILDCARD) return undefined;
  let quality = 1;
  for (const parameter of parameters) {
    const [name = "", value = ""] = parameter.split("=", 2);
    if (name.trim().toLowerCase() !== "q") continue;
    // The parameters after `q` are extensions that this reads past.
    if (!QUALITY.test(value.trim())) return undefined;
    quality = Number(value.trim());
    break;
  }
  return { type, subtype, quality };
}

/** How exactly a range names a media type: 2 for the type and subtype, 1 for the type and `*`, 0 for `*` and `*`, -1 for no match. */
function specificity(range: MediaRange, type: string, subtype: string): number {
  if (range.type === type && range.subtype === subtype) return 2;
  if (range.type === type && range.subtype === WILDCARD) return 1;
  if (range.type === WILDCARD) return 0;
  return -1;
}

/** The weight of a media type: that of its most specific range, and 0 when no range names it. */
function weight(ranges: readonly MediaRange[], offered: string): number {
  const [type = "", subtype = ""] = offered.toLowerCase().split("/");
  let best = -1;
  let quality = 0;
  for (const range of ranges) {
    const named = specificity(range, type, subtype);
    if (named < 0) continue;
    if (named > best || (named === best && range.quality > quality)) {
      best = named;
      quality = range.quality;
    }
  }
  return quality;
}

/**
 * Chooses the media type of an answer from the `Accept` header of the request (RFC 9110 section 12.5.1).
 *
 * @remarks
 * A media type takes the weight `q` of the most specific range that names it: `type/subtype` over `type/*` over `*` and `*`.
 * The highest weight wins, and the first of the offered types wins a tie. Parameters other than `q` are ignored. An entry
 * that is not a media range or has an invalid weight accepts nothing. When the header is absent, or accepts none of the
 * types, the first offered type is the choice, because an error still has to be answered in some format.
 *
 * @param accept - The `Accept` header of the request, or `undefined` when it has none.
 * @param offered - The media types the answer can have, such as `application/json`, with the preferred one first: at least one.
 * @returns One of the offered types, as it was given.
 */
export function negotiate(accept: string | undefined, offered: readonly [string, ...string[]]): string {
  const ranges = (accept ?? "").split(",").flatMap((entry) => readRange(entry) ?? []);
  let chosen = offered[0];
  let chosenWeight = 0;
  for (const type of offered) {
    const candidate = weight(ranges, type);
    if (candidate > chosenWeight) {
      chosen = type;
      chosenWeight = candidate;
    }
  }
  return chosen;
}
