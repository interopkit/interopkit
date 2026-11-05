import { DataError } from "@interopkit/core";
import {
  checkString,
  MAX_JSON_TOKENS,
  parseJsonText,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { findRepeatedProperty } from "./repeated-property.js";
import { checkTextBytes } from "./text-bytes.js";

/** The most bytes of text that `parseStatementJson` reads unless the caller says otherwise: 10 MiB, the size of an LRS request. */
const DEFAULT_MAX_BYTES = 10_485_760;

/** The deepest nesting of arrays and objects that `parseStatementJson` reads unless the caller says otherwise. */
const DEFAULT_MAX_DEPTH = 64;

/** The options of `parseStatementJson`. */
export interface ParseStatementJsonOptions {
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
 * @throws `LimitError` of `@interopkit/core`, a `DataError`, when the text has more bytes, levels or tokens than the limits:
 * an LRS answers 413.
 * @throws `DataError` when the text is not JSON, or has a property twice, or when the options are not valid.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function parseStatementJson(text: string, options?: ParseStatementJsonOptions): unknown {
  checkString(text, "The text");
  const {
    maxBytes = DEFAULT_MAX_BYTES,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxTokens = MAX_JSON_TOKENS,
  } = parseWith(optionsSchema, options === undefined ? {} : options, "The options object");
  checkTextBytes(text, maxBytes, "The text");
  // `JSON.parse` is the judge of the syntax of RFC 8259, and the search for a repeated property relies on it.
  const value = parseJsonText(
    text,
    { maxDepth, maxTokens },
    {
      depth: `The text nests arrays and objects deeper than the limit of ${maxDepth} levels.`,
      tokens: `The text has more than ${maxTokens} tokens, above the limit of the option maxTokens.`,
      syntax: (error) => `The text is not valid JSON: ${String(error)}.`,
    },
  );
  const repeat = findRepeatedProperty(text);
  if (repeat !== undefined) {
    const where = repeat.path === "" ? "" : ` in ${repeat.path}`;
    throw new DataError(
      `The text has the property ${JSON.stringify(repeat.name)} twice${where}, at line ${repeat.line} column ${repeat.column}. An LRS rejects a property that occurs more than once.`,
    );
  }
  return value;
}
