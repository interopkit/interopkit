import { DataError } from "@interopkit/core";
import {
  checkString,
  findExceededJsonLimit,
  MAX_JSON_TOKENS,
  nestsDeeperThan,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { findRepeatedProperty } from "./repeated-property.js";

/** The most bytes of text that `readStatementJson` reads unless the caller says otherwise: 10 MiB, the size of an LRS request. */
const DEFAULT_MAX_BYTES = 10_485_760;

/** The deepest nesting of arrays and objects that `readStatementJson` reads unless the caller says otherwise. */
const DEFAULT_MAX_DEPTH = 64;

/** The limit of a text of JSON that it went over. */
export type JsonLimit = "bytes" | "tokens";

/** The error for a text of JSON over a limit of its size, which a handler answers with 413 and not with 400. */
export class JsonLimitError extends DataError {
  /** Error class name. */
  override name = "JsonLimitError";
  /** The limit that the text went over. */
  readonly limit: JsonLimit;

  /**
   * @param message - Says which limit the text went over.
   * @param limit - The limit.
   */
  constructor(message: string, limit: JsonLimit) {
    super(message);
    this.limit = limit;
  }
}

/** The options of `readStatementJson`. */
export interface ReadStatementJsonOptions {
  /**
   * The most bytes of the text, counted as UTF-8.
   *
   * @defaultValue 10,485,760
   */
  readonly maxBytes?: number;
  /**
   * The deepest nesting of arrays and objects: `[]` has depth 1 and `[[]]` has depth 2.
   *
   * @defaultValue 64
   */
  readonly maxDepth?: number;
  /**
   * The most tokens of the text: each bracket, brace, colon and comma, each string, each number, and each of `true`, `false`
   * and `null`. The memory of a parse grows with the tokens and not with the bytes.
   *
   * @defaultValue 1,000,000
   */
  readonly maxTokens?: number;
}

const optionsSchema = strictRecord({
  maxBytes: v.optional(positiveIntegerSchema),
  maxDepth: v.optional(positiveIntegerSchema),
  maxTokens: v.optional(positiveIntegerSchema),
});

/**
 * Parses the text of a Statement, or of a batch of them, as JSON, and refuses an object that has a property twice.
 *
 * @remarks
 * `JSON.parse` keeps the last of two properties with one name and says nothing, so an LRS that reads a request with it cannot
 * obey the rule that it shall reject a Statement that uses a property more than once (4.2.1). A name is the same when its
 * characters are, whatever the escapes that write them. The size, the depth and the number of tokens are checked before the
 * text is parsed, and a property named `__proto__` is a property of the result and changes no prototype. The parse takes memory
 * for each token and not for each byte, and `[{},{},` and so on is a token for every byte, so `maxTokens` bounds it: a million
 * tokens of distinct names, the worst for the search of a repeat, which keeps the names of the open objects and nothing else,
 * raise the peak of a process by 58 to 65 MiB. A host with less memory, such as a Cloudflare Worker, passes a smaller one.
 *
 * @param text - The text of a request or a file.
 * @param options - The limits.
 * @returns The parsed value, which `readStatement` or `validateStatements` reads.
 * @throws `JsonLimitError`, a `DataError`, when the text is longer or has more tokens than the limits.
 * @throws `DataError` when the text is deeper than the limit, is not JSON, or has a property twice, or when the options are not
 * valid.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function readStatementJson(text: string, options?: ReadStatementJsonOptions): unknown {
  checkString(text, "The text");
  const {
    maxBytes = DEFAULT_MAX_BYTES,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxTokens = MAX_JSON_TOKENS,
  } = parseWith(optionsSchema, options === undefined ? {} : options, "The options object");
  // A string of more units than the limit has more bytes than it, so the longer ones need no encoding.
  const bytes = text.length > maxBytes ? text.length : new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    throw new JsonLimitError(`The text has ${bytes} bytes or more, above the limit of ${maxBytes} bytes.`, "bytes");
  }
  // One reading finds the first limit that the text passes. The depth is refused before the tokens, so a text that passes the
  // tokens first is read on for its depth.
  const excess = findExceededJsonLimit(text, maxDepth, maxTokens);
  if (excess === "depth" || (excess === "tokens" && nestsDeeperThan(text, maxDepth))) {
    throw new DataError(`The text nests arrays and objects deeper than the limit of ${maxDepth} levels.`);
  }
  if (excess === "tokens") {
    throw new JsonLimitError(
      `The text has more than ${maxTokens} tokens, above the limit of the option maxTokens.`,
      "tokens",
    );
  }
  let value: unknown;
  try {
    // `JSON.parse` is the judge of the syntax of RFC 8259, and the search for a repeated property relies on it.
    value = JSON.parse(text);
  } catch (error) {
    throw new DataError(`The text is not valid JSON: ${String(error)}.`);
  }
  const repeat = findRepeatedProperty(text);
  if (repeat !== undefined) {
    const where = repeat.path === "" ? "" : ` in ${repeat.path}`;
    throw new DataError(
      `The text has the property ${JSON.stringify(repeat.name)} twice${where}, at line ${repeat.line} column ${repeat.column}. An LRS rejects a property that occurs more than once.`,
    );
  }
  return value;
}
