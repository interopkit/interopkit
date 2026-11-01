import { checkPositiveInteger, checkRecord } from "../checks.js";
import { DataError } from "../errors.js";
import { MAX_JSON_DEPTH } from "../json.js";
import type { HttpRequest } from "./request.js";

/** The most bytes of a JSON body that `readJson` reads unless the caller says otherwise. */
const DEFAULT_MAX_JSON_BYTES = 1_048_576;

/** Throws on bytes that are not UTF-8, where the default decoder would replace them. */
const DECODER = new TextDecoder("utf-8", { fatal: true });

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;

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
}

/** Returns the index of the quote that ends the string which starts at `start`, or the length of the text when it does not end. */
function endOfString(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    // A backslash escapes the next unit, which may be a quote.
    if (unit === BACKSLASH) index += 1;
    else if (unit === QUOTE) return index;
  }
  return text.length;
}

/** Tells whether arrays and objects nest deeper than the limit, reading no further than the first level above it. */
function nestsDeeperThan(text: string, maxDepth: number): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === QUOTE) {
      index = endOfString(text, index);
    } else if (unit === OPEN_BRACE || unit === OPEN_BRACKET) {
      depth += 1;
      if (depth > maxDepth) return true;
    } else if (unit === CLOSE_BRACE || unit === CLOSE_BRACKET) {
      depth -= 1;
    }
  }
  return false;
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
  } catch {
    throw new DataError("The body of the request must be UTF-8 text, and it holds bytes that are not UTF-8.");
  }
}

/**
 * Reads the body of a request as JSON, within limits on its size and its depth.
 *
 * @remarks
 * The depth is checked before the text is parsed, so a body of ten thousand opening brackets is refused without building
 * anything. A key that is `__proto__` becomes an own property of the result and changes no prototype.
 *
 * @param request - The request, which `checkHttpRequest` has accepted.
 * @param options - The limits. Default: 1,048,576 bytes and depth 64.
 * @returns The parsed value.
 * @throws `DataError` when the options are not valid, or the body is larger or deeper than the limits, is not UTF-8, or is
 * not JSON.
 */
export function readJson(request: HttpRequest, options: ReadJsonOptions = {}): unknown {
  checkRecord(options, "The options of readJson must be an object");
  if (options.maxBytes !== undefined) checkPositiveInteger(options.maxBytes, "The option maxBytes");
  if (options.maxDepth !== undefined) checkPositiveInteger(options.maxDepth, "The option maxDepth");
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  const maxDepth = options.maxDepth ?? MAX_JSON_DEPTH;
  if (request.body.byteLength > maxBytes) {
    throw new DataError(
      `The body of the request has ${request.body.byteLength} bytes, above the limit of ${maxBytes} bytes.`,
    );
  }
  const text = readText(request);
  if (nestsDeeperThan(text, maxDepth)) {
    throw new DataError(`The JSON of the request nests deeper than the limit of ${maxDepth} levels.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError("The body of the request must be JSON, and it is not valid JSON.");
  }
}
