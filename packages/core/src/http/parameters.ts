import { checkPositiveInteger, checkRecord, describe } from "../checks.js";
import { DataError, LimitError } from "../errors.js";
import { readText } from "./body.js";
import type { HttpRequest } from "./request.js";

const FORM_TYPE = "application/x-www-form-urlencoded";
const PLUS = 0x2b;
const SPACE = 0x20;

/** Collects the parameters of a query or a form into a map. */
function collect(parameters: URLSearchParams, where: string): ReadonlyMap<string, string> {
  const collected = new Map<string, string>();
  for (const [name, value] of parameters) {
    // RFC 6749 section 3.1: a request parameter must not occur more than once.
    if (collected.has(name)) throw new DataError(`${where} has the parameter ${describe(name)} more than once.`);
    collected.set(name, value);
  }
  return collected;
}

/**
 * Reads the parameters of the query of a request.
 *
 * @param request - The request, which `checkHttpRequest` has accepted.
 * @returns The parameters by name.
 * @throws `DataError` when a parameter occurs more than once.
 */
export function readQuery(request: HttpRequest): ReadonlyMap<string, string> {
  return collect(new URL(request.url).searchParams, "The query of the request");
}

/** What `readForm` limits. */
export interface ReadFormOptions {
  /**
   * The most bytes of the body, measured before anything is decoded.
   *
   * @defaultValue no limit, as `readText`: the host caps the size of a body before it builds the request
   */
  readonly maxBytes?: number;
}

/**
 * Reads the parameters of the form that a request carries.
 *
 * @param request - The request, which `checkHttpRequest` has accepted.
 * @param options - The limit on the size of the body.
 * @returns The parameters by name.
 * @throws `LimitError`, a `DataError`, when the body has more bytes than `maxBytes`: answer 413.
 * @throws `DataError` when the options are not valid, or the body is not `application/x-www-form-urlencoded`, is not UTF-8,
 * or a parameter occurs more than once.
 */
export function readForm(request: HttpRequest, options: ReadFormOptions = {}): ReadonlyMap<string, string> {
  checkRecord(options, "The options of readForm must be an object");
  if (options.maxBytes !== undefined) checkPositiveInteger(options.maxBytes, "The option maxBytes");
  const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (type !== FORM_TYPE) {
    throw new DataError(`The content type of the request must be ${FORM_TYPE}, found ${describe(type)}.`);
  }
  if (options.maxBytes !== undefined && request.body.byteLength > options.maxBytes) {
    throw new LimitError(
      `The body of the request has ${request.body.byteLength} bytes, above the limit of ${options.maxBytes} bytes.`,
      "maxBytes",
      options.maxBytes,
    );
  }
  // A `+` is a space. Written so here, on the bytes, it costs a form of 10 MiB no memory: URLSearchParams joins a rope with a node
  // for each `+` in Node.js, and a replacement in a string keeps a part for each.
  const body = request.body.slice();
  for (let index = 0; index < body.length; index += 1) if (body[index] === PLUS) body[index] = SPACE;
  return collect(new URLSearchParams(readText({ ...request, body })), "The form of the request");
}
