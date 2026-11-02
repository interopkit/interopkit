import { parseDateTime } from "@interopkit/core/checks";
import * as v from "valibot";
import { KEYWORD_TERMS_V2, PREFIXES_V2, TERMS_V2 } from "./context-v2.js";

/** A UUID URN of versions 1 to 5, in either case, which Open Badges 2.0 recommends as the `id` of a signed assertion. */
const URN_UUID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** The identifier of a blank node of JSON-LD. */
const BLANK_NODE = /^_:/u;

/**
 * A date and time as Open Badges 2.0 describes it: the year, month and day, `T`, the hour and minute, optional seconds with an
 * optional fraction, and `Z` or an offset of hours with optional minutes.
 */
const DATE_TIME_V2 = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/u;

/** A data URI: `data:`, its media types and parameters, an optional `base64`, a comma and the data (RFC 2397). */
const DATA_URI = /^data:([^,]*?)(?:;base64)?,/iu;

/** The media types that an image of Open Badges 2.0 may have: it must be a PNG or an SVG. */
const IMAGE_MEDIA_TYPES = ["image/png", "image/svg+xml"] as const;

/** An address of an email, as the validator of 1EdTech reads it: a local part, `@` and a domain, without white space. */
const EMAIL = /^[^@\s]+@[^@\s]+$/u;

/** A phone number of E.164, with an optional extension. */
const TELEPHONE = /^\+?[1-9]\d{1,14}(;ext=\d+)?$/u;

/** A host name of at least one dot, with labels of at most 63 characters, and no port. */
const HOST_NAME = /^(?=.{4,253}$)((?!-)[a-zA-Z0-9-]{0,62}[a-zA-Z0-9]\.)+[a-zA-Z]{2,63}$/u;

/**
 * Tells whether text is a URL of the schemes `http` and `https`, the only ones that Open Badges 2.0 expects an interpreter to
 * read.
 *
 * @param text - The text.
 */
export function isUrlV2(text: string): boolean {
  return /^https?:\/\//iu.test(text) && URL.canParse(text);
}

/**
 * Tells whether text is an IRI as Open Badges 2.0 uses one for an identifier: an HTTP or HTTPS URL, a `urn:uuid`, or a blank
 * node of JSON-LD.
 *
 * @param text - The text.
 */
function isIriV2(text: string): boolean {
  return isUrlV2(text) || URN_UUID.test(text) || BLANK_NODE.test(text);
}

/**
 * Tells whether text is a data URI of a PNG or an SVG image.
 *
 * @param text - The text.
 */
function isImageDataUri(text: string): boolean {
  const media = DATA_URI.exec(text)?.[1]?.toLowerCase();
  return media !== undefined && IMAGE_MEDIA_TYPES.some((type) => media.split(";").includes(type));
}

/**
 * Reads a date and time of Open Badges 2.0, such as `2016-12-31T23:59:59+00:00`, into milliseconds since
 * 1970-01-01T00:00:00Z.
 *
 * @remarks
 * Open Badges 2.0 asks for ISO 8601 with the time and a time zone: the seconds may be left out, and an offset may be hours
 * alone or hours and minutes with or without a colon. The text is written in the form of RFC 3339 and read by
 * `parseDateTime` of `core/checks`, which knows the days of each month and the range of an hour, a minute and an offset.
 *
 * @param text - The text.
 * @returns The instant, or `undefined` when the text is not a date and time of that form.
 */
export function parseDateTimeV2(text: string): number | undefined {
  const match = DATE_TIME_V2.exec(text);
  if (match === null) return undefined;
  const [, date = "", hour = "", minute = "", second = "00", fraction = "", sign, offsetHour, offsetMinute = "00"] =
    match;
  const zone = sign === undefined ? "Z" : `${sign}${offsetHour}:${offsetMinute}`;
  return parseDateTime(`${date}T${hour}:${minute}:${second}${fraction}${zone}`);
}

/**
 * Tells whether a value of `type` names a class that the context of Open Badges 2.0 expands to an IRI: a term of the context,
 * a compact IRI of one of its prefixes, or an IRI.
 *
 * @param text - The value.
 */
function isTypeTermV2(text: string): boolean {
  if (TERMS_V2.has(text)) return !KEYWORD_TERMS_V2.has(text);
  const colon = text.indexOf(":");
  return (colon > 0 && PREFIXES_V2.has(text.slice(0, colon))) || isIriV2(text);
}

/**
 * Tells whether text names a property under the context of Open Badges 2.0: a term of the context, or a compact or absolute
 * IRI, which JSON-LD reads as a property.
 *
 * @param text - The text.
 */
function isPropertyTermV2(text: string): boolean {
  return TERMS_V2.has(text) || text.includes(":");
}

/** An IRI that identifies an object: an HTTP or HTTPS URL, a `urn:uuid` or a blank node. */
export const iriV2 = v.pipe(
  v.string(),
  v.check(isIriV2, (issue) => `expected an HTTP or HTTPS URL, a urn:uuid or a blank node, found ${issue.received}`),
);

/** An HTTP or HTTPS URL. */
export const urlV2 = v.pipe(
  v.string(),
  v.check(isUrlV2, (issue) => `expected an HTTP or HTTPS URL, found ${issue.received}`),
);

/** The address of an image that may be held in the document: an HTTP or HTTPS URL, or a data URI of a PNG or an SVG. */
export const imageAddressV2 = v.pipe(
  v.string(),
  v.check(
    (text) => isUrlV2(text) || isImageDataUri(text),
    (issue) => `expected an HTTP or HTTPS URL, or a data URI of a PNG or SVG image, found ${issue.received}`,
  ),
);

/** A date and time of ISO 8601 with a time zone, such as `2016-12-31T23:59:59+00:00`. */
export const dateTimeV2 = v.pipe(
  v.string(),
  v.check(
    (text) => parseDateTimeV2(text) !== undefined,
    (issue) =>
      `expected a date and time of ISO 8601 with a time zone, such as 2016-12-31T23:59:59+00:00, found ${issue.received}`,
  ),
);

/** An address of an email. */
export const emailV2 = v.pipe(
  v.string(),
  v.regex(EMAIL, (issue) => `expected an email address, found ${issue.received}`),
);

/** A phone number of E.164, such as `+16175551212`. */
export const telephoneV2 = v.pipe(
  v.string(),
  v.regex(TELEPHONE, (issue) => `expected a phone number of E.164, such as +16175551212, found ${issue.received}`),
);

/** The host name of an allowed origin, such as `example.org`. */
export const hostNameV2 = v.pipe(
  v.string(),
  v.regex(HOST_NAME, (issue) => `expected a host name such as example.org, found ${issue.received}`),
);

/** The name of a property, such as the `verificationProperty` of a verification object. */
export const propertyTermV2 = v.pipe(
  v.string(),
  v.check(
    isPropertyTermV2,
    (issue) => `expected a term of the context of Open Badges 2.0 or an IRI, found ${issue.received}`,
  ),
);

/** A value of `type`: a class that the context expands to an IRI. */
export const typeTermV2 = v.pipe(
  v.string(),
  v.check(
    isTypeTermV2,
    (issue) =>
      `expected a term of the context of Open Badges 2.0, a compact IRI of one of its prefixes, or an IRI, found ${issue.received}`,
  ),
);
