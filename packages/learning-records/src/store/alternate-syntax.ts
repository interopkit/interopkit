import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { type HttpRequest, readForm, readQuery } from "@interopkit/core/http";
import { attempt, refused, type Verdict } from "./verdict.js";

/** The query parameter that names the method of a request in the alternate request syntax (1.0.3 Communication 1.3). */
const METHOD = "method";

/** The form parameter that holds the content of the request. */
const CONTENT = "content";

/** The methods that a request in the alternate syntax may name: those of the resources of an LRS. */
const METHODS = ["GET", "HEAD", "PUT", "POST", "DELETE"] as const;

/** The headers that the form may carry in place of the headers of the request (1.0.3 Communication 1.3), in lower case. */
const FORM_HEADERS = new Set([
  "authorization",
  "x-experience-api-version",
  "content-type",
  "content-length",
  "if-match",
  "if-none-match",
]);

/** The headers that describe the form itself, and not the request that it carries. */
const FORM_FRAMING = new Set(["content-type", "content-length"]);

/**
 * The most parameters of a form: the query of the Statements resource with its cursor, the six headers, and the content, with
 * room. The memory of a form grows with its parameters and not with its bytes, so a form over the limit is refused unread.
 */
const MAX_FIELDS = 32;

/** The byte that separates the parameters of a form. */
const AMPERSAND = 0x26;

/** The type of the content when the form does not name one: the content of the requests of an LRS is JSON but for documents. */
const JSON_TYPE = "application/json";

/** Tells whether a request uses the alternate request syntax: a POST whose query names a method. */
export function isAlternateRequest(request: HttpRequest): boolean {
  return request.method === "POST" && new URL(request.url).searchParams.has(METHOD);
}

/** Tells whether text is a method that the alternate syntax may name. */
function isMethod(text: string | undefined): text is (typeof METHODS)[number] {
  return METHODS.some((method) => method === text);
}

/** Reads the method that the query names, which must be the only parameter of the query. */
function methodOf(request: HttpRequest): (typeof METHODS)[number] {
  const query = readQuery(request);
  const method = query.get(METHOD);
  if (!isMethod(method)) {
    throw new DataError(`The parameter method must be one of ${METHODS.join(", ")}, found ${describe(method)}.`);
  }
  const others = [...query.keys()].filter((name) => name !== METHOD);
  if (others.length > 0) {
    throw new DataError(
      `A request in the alternate syntax has no query parameter but method, found ${others.map((name) => describe(name)).join(", ")}: send them as form parameters.`,
    );
  }
  return method;
}

/** Builds the request that a form of the alternate syntax carries. */
function carried(request: HttpRequest): HttpRequest {
  const method = methodOf(request);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) if (!FORM_FRAMING.has(name)) headers[name] = value;
  const parameters = new URLSearchParams();
  let content: string | undefined;
  for (const [name, value] of readForm(request)) {
    const header = name.toLowerCase();
    if (name === CONTENT) content = value;
    // The length in the form is that of the content, which is the body of the carried request and has its own length.
    else if (FORM_HEADERS.has(header)) {
      if (header !== "content-length") headers[header] = value;
    } else parameters.append(name, value);
  }
  if (content !== undefined) headers["content-type"] ??= JSON_TYPE;
  const url = new URL(request.url);
  url.search = parameters.toString();
  return { method, url: url.href, headers, body: new TextEncoder().encode(content ?? "") };
}

/**
 * Reads a request in the alternate request syntax of xAPI 1.0.3 (Communication 1.3): a POST whose query names the method of the
 * request, and whose form carries the headers that a browser could not set, the parameters of the query, and the content.
 *
 * @remarks
 * The headers of the form replace those of the request; their names are matched in any case, as HTTP header names are. The
 * content is UTF-8 text, and its type is the `Content-Type` of the form, or `application/json` when the form names none. A
 * query parameter other than `method` is refused, since the syntax puts every parameter in the form. The body is at most
 * `maxBytes`, and the parameters are counted before the form is read, so a form costs no more memory than any other request.
 *
 * @returns The request that the form carries, or the refusal: 413 for a body over the limit, 400 for a form that is not one or
 * that has too many parameters.
 */
export function readAlternateRequest(request: HttpRequest, maxBytes: number): Verdict<HttpRequest> {
  if (request.body.byteLength > maxBytes) {
    return refused(413, `The body has ${request.body.byteLength} bytes, above the limit of ${maxBytes} bytes.`);
  }
  let fields = 1;
  for (const byte of request.body) if (byte === AMPERSAND) fields += 1;
  if (fields > MAX_FIELDS) return refused(400, `The form has ${fields} parameters, above the limit of ${MAX_FIELDS}.`);
  return attempt(() => carried(request));
}
