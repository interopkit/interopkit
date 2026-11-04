import { checkPositiveInteger, checkRecord, parseJsonText } from "../checks.js";
import { DataError, LimitError } from "../errors.js";
import { MAX_JSON_DEPTH, MAX_JSON_TOKENS } from "../json.js";
import type { HttpRequest } from "./request.js";

/** The most bytes of a JSON body that `readJson` reads unless the caller says otherwise. */
const DEFAULT_MAX_JSON_BYTES = 1_048_576;

/** Throws on bytes that are not UTF-8, where the default decoder would replace them. */
const DECODER = new TextDecoder("utf-8", { fatal: true });

/** What `readJson` limits. */
export interface ReadJsonOptions {
  /**
   * The most bytes of the body.
   *
   * @defaultValue 1,048,576
   */
  readonly maxBytes?: number;
  /**
   * The deepest nesting of arrays and objects: `[]` has depth 1 and `[[]]` has depth 2.
   *
   * @defaultValue 64
   */
  readonly maxDepth?: number;
  /**
   * The most tokens of the body: each bracket, brace, colon and comma, each string, each number, and each of `true`, `false`
   * and `null`. The memory of a parse grows with the tokens and not with the bytes.
   *
   * @defaultValue 1,000,000
   */
  readonly maxTokens?: number;
}

/**
 * Reads the body of a request as UTF-8 text.
 *
 * @remarks
 * A byte order mark at the start is dropped. The handlers of the packages check the size of a body before they build a
 * request, so this function sets no limit.
 *
 * @param request - The request, which `checkHttpRequest` has accepted.
 * @returns The text, or the empty string for an empty body.
 * @throws `DataError` when the body holds bytes that are not UTF-8.
 */
export function readText(request: HttpRequest): string {
  try {
    return DECODER.decode(request.body);
  } catch (error) {
    throw new DataError("The body of the request must be UTF-8 text, and it holds bytes that are not UTF-8.", {
      cause: error,
    });
  }
}

/**
 * Reads the body of a request as JSON, within limits on its size, its depth and its tokens.
 *
 * @remarks
 * The depth and the tokens are checked before the text is parsed, so a body of ten thousand opening brackets, or of a million
 * empty arrays, is refused without building anything. A key that is `__proto__` becomes an own property of the result and
 * changes no prototype.
 *
 * @param request - The request, which `checkHttpRequest` has accepted.
 * @param options - The limits. Default: 1,048,576 bytes, depth 64 and 1,000,000 tokens.
 * @returns The parsed value.
 * @throws `LimitError`, a `DataError`, when the body has more bytes, levels or tokens than the limits: answer 413.
 * @throws `DataError` when the options are not valid, or the body is not UTF-8 or not JSON.
 */
export function readJson(request: HttpRequest, options: ReadJsonOptions = {}): unknown {
  checkRecord(options, "The options of readJson must be an object");
  if (options.maxBytes !== undefined) checkPositiveInteger(options.maxBytes, "The option maxBytes");
  if (options.maxDepth !== undefined) checkPositiveInteger(options.maxDepth, "The option maxDepth");
  if (options.maxTokens !== undefined) checkPositiveInteger(options.maxTokens, "The option maxTokens");
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  const maxDepth = options.maxDepth ?? MAX_JSON_DEPTH;
  const maxTokens = options.maxTokens ?? MAX_JSON_TOKENS;
  if (request.body.byteLength > maxBytes) {
    throw new LimitError(
      `The body of the request has ${request.body.byteLength} bytes, above the limit of ${maxBytes} bytes.`,
      "maxBytes",
      maxBytes,
    );
  }
  const text = readText(request);
  return parseJsonText(
    text,
    { maxDepth, maxTokens },
    {
      depth: `The JSON of the request nests deeper than the limit of ${maxDepth} levels.`,
      tokens: `The JSON of the request has more than ${maxTokens} tokens, above the limit of the option maxTokens.`,
      syntax: () => "The body of the request must be JSON, and it is not valid JSON.",
    },
  );
}
