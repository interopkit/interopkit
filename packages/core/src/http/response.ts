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

/** The options of `buildJsonResponse`. */
export interface JsonResponseOptions {
  /**
   * More headers, which win over `content-type`.
   *
   * @defaultValue none
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * The media type.
   *
   * @defaultValue `application/json;charset=UTF-8`
   */
  readonly type?: string;
}

/**
 * Builds an answer with a JSON body and a media type.
 *
 * @param status - The HTTP status code.
 * @param body - The value to serialize with `JSON.stringify`.
 * @param options - The headers and the media type of the answer.
 * @returns The answer.
 */
export function buildJsonResponse(status: number, body: unknown, options: JsonResponseOptions = {}): HttpResponse {
  const { headers = {}, type = "application/json;charset=UTF-8" } = options;
  return { status, headers: { "content-type": type, ...headers }, body: JSON.stringify(body) };
}
