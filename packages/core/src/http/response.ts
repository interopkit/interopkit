/** An answer in a form that does not depend on a web framework. The host sends it. */
export interface HttpResponse {
  /** The HTTP status code. */
  readonly status: number;
  /** The headers, by name. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * The body: text is sent as UTF-8, and bytes are a `Uint8Array` over an `ArrayBuffer`, which a web `Response` accepts.
   * The empty string when the answer has none.
   */
  readonly body: string | Uint8Array<ArrayBuffer>;
}

/**
 * Builds an answer with a JSON body and a media type.
 *
 * @param status - The HTTP status code.
 * @param body - The value to serialize with `JSON.stringify`.
 * @param headers - More headers, which win over `content-type`. Default: none.
 * @param type - The media type. Default: `application/json;charset=UTF-8`.
 * @returns The answer.
 */
export function jsonResponse(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
  type = "application/json;charset=UTF-8",
): HttpResponse {
  return { status, headers: { "content-type": type, ...headers }, body: JSON.stringify(body) };
}
