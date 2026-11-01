import { checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";

/**
 * A request in a form that does not depend on a web framework. The host builds it from its own request type, and the
 * handlers of the packages read only these four properties.
 */
export interface HttpRequest {
  /** The method in upper case, such as `GET` or `POST`. */
  readonly method: string;
  /** The absolute URL of the request, with its query. */
  readonly url: string;
  /** The headers, by name in lower case, such as `cookie` and `origin`. */
  readonly headers: Readonly<Record<string, string>>;
  /** The body as bytes, or an empty array when the request has none. */
  readonly body: Uint8Array;
}

/**
 * Checks the shape of a request, as a host passes it from JavaScript. What the headers and the body hold is for the
 * handler to read.
 *
 * @throws `DataError` when it is not an object with a `method` and an absolute `url` that are strings, a `body` that is a
 * `Uint8Array`, and `headers` that are strings by name in lower case.
 */
export function checkHttpRequest(value: unknown): asserts value is HttpRequest {
  checkRecord(value, "The request must be an object");
  checkString(value.method, "The method of the request");
  checkString(value.url, "The URL of the request");
  if (!URL.canParse(value.url)) {
    throw new DataError(`The URL of the request must be an absolute URL, found ${describe(value.url)}.`);
  }
  if (!(value.body instanceof Uint8Array)) {
    // A string body is not echoed: it may hold a token.
    const found = typeof value.body === "string" ? "a string" : describe(value.body);
    throw new DataError(
      `The body of the request must be a Uint8Array, found ${found}: encode text with a TextEncoder.`,
    );
  }
  const { headers } = value;
  checkRecord(headers, "The headers of the request must be an object");
  for (const [name, header] of Object.entries(headers)) {
    checkString(header, `The header ${describe(name)} of the request`);
    if (name !== name.toLowerCase()) {
      throw new DataError(`The header names of the request must be in lower case, found ${describe(name)}.`);
    }
  }
}
