import { finiteSchema, isAbsoluteUri, nonNegativeIntegerSchema, parseDateTime } from "@interopkit/core/checks";
import * as v from "valibot";

/** The greatest value of an unsigned 32-bit integer: the `uint32` format that the schemas of Caliper give to counts. */
const UINT32_MAX = 4_294_967_295;

/** The form of a blank node identifier: `_:` and a name without white space (Caliper 1.2 section 4.2). */
const BLANK_NODE = /^_:\S+$/u;

/** The form of a time that Caliper writes: millisecond precision and UTC with no offset (Caliper 1.2 section 2.1). */
const TIME_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/**
 * An ISO 8601 duration: years, months and days, then a time of hours, minutes and seconds, or a count of weeks. At least one
 * part is there, and a time has at least one part.
 */
const DURATION = /^P(?:\d+W|(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?)$/u;

/** Tells whether text is a time in the form that `caliperTime` writes, and a date that exists. */
function isCaliperTime(text: string): boolean {
  const at = parseDateTime(text);
  // The comparison also rejects a leap second, which RFC 3339 allows and `caliperTime` never writes.
  return at !== undefined && TIME_FORM.test(text) && new Date(at).toISOString() === text;
}

/** A string. Caliper gives names, descriptions and labels no more form than that. */
export const text = v.string();

/** An absolute IRI, or a blank node identifier for an entity that has none (Caliper 1.2 section 4.2). */
export const iri = v.pipe(
  v.string(),
  v.check(
    (value) => isAbsoluteUri(value) || BLANK_NODE.test(value),
    (issue) => `expected an absolute IRI or a blank node identifier, found ${issue.received}`,
  ),
);

/** The identifier of an event: a UUID as a URN, `urn:uuid:` and a UUID of either case, as RFC 4122 reads one (section 3). */
export const urn = v.pipe(
  v.string(),
  v.regex(
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
    (issue) => `expected a UUID URN, \`urn:uuid:\` and a UUID, found ${issue.received}`,
  ),
);

/** A time as `YYYY-MM-DDTHH:mm:ss.SSSZ`, in UTC. */
export const time = v.pipe(
  v.string(),
  v.check(isCaliperTime, (issue) => `expected a time as YYYY-MM-DDTHH:mm:ss.SSSZ, found ${issue.received}`),
);

/** A duration in the ISO 8601 form, such as `PT10M30S`. */
export const duration = v.pipe(
  v.string(),
  v.regex(DURATION, (issue) => `expected an ISO 8601 duration such as PT10M30S, found ${issue.received}`),
);

/** A count: an integer from 0 to 4,294,967,295. */
export const count = v.pipe(
  v.number(),
  v.safeInteger(),
  v.minValue(0),
  v.maxValue(UINT32_MAX, (issue) => `expected a value of at most ${UINT32_MAX}, found ${issue.received}`),
);

/** A position: a non-negative integer. */
export const position = nonNegativeIntegerSchema;

/** A decimal number. */
export const decimal = finiteSchema;

/** A true or false value. */
export const flag = v.boolean();

/** A list of strings. */
export const texts = v.array(text);

/**
 * The schema of a term of a vocabulary.
 *
 * @param terms - The terms.
 * @param what - Says what the term is, such as `an action`.
 */
export function term<const TTerms extends readonly [string, ...string[]]>(terms: TTerms, what: string) {
  return v.picklist(terms, (issue) => `expected ${what} of Caliper, found ${issue.received}`);
}
