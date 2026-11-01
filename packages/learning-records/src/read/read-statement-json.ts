import { type AnyNode, evaluate, type ObjectNode, parse } from "@humanwhocodes/momoa";
import { DataError } from "@interopkit/core";
import { checkString, nestsDeeperThan, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { hasMoreTokensThan } from "./json-tokens.js";
import { item, member } from "./path.js";

/** The most bytes of text that `readStatementJson` reads unless the caller says otherwise: 10 MiB, the size of an LRS request. */
const DEFAULT_MAX_BYTES = 10_485_760;

/** The deepest nesting of arrays and objects that `readStatementJson` reads unless the caller says otherwise. */
const DEFAULT_MAX_DEPTH = 64;

/**
 * The most tokens that `readStatementJson` reads unless the caller says otherwise. The parse takes up to 250 bytes of memory for
 * each token, measured on the worst text, so this keeps its peak near 280 MB; 1,000 Statements that use every property have
 * 461,000 tokens.
 */
const DEFAULT_MAX_TOKENS = 1_000_000;

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
   * and `null`. The memory of the syntax tree grows with the tokens and not with the bytes.
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

/** The place in a text where a property occurs again, and its name. */
interface Repeat {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly column: number;
}

/** Finds the first property that an object of the tree has twice, in the order of the text. */
function findInObject(node: ObjectNode, path: string): Repeat | undefined {
  const seen = new Set<string>();
  for (const entry of node.members) {
    const name = String(evaluate(entry.name));
    if (seen.has(name)) return { path, name, line: entry.loc.start.line, column: entry.loc.start.column };
    seen.add(name);
    const found = findRepeat(entry.value, member(path, name));
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Finds the first object of a tree that has a property twice, walking in the order of the text. */
function findRepeat(node: AnyNode, path: string): Repeat | undefined {
  if (node.type === "Object") return findInObject(node, path);
  if (node.type !== "Array") return undefined;
  for (const [index, element] of node.elements.entries()) {
    const found = findRepeat(element.value, item(path, index));
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Finds the first property that an object of the text has twice. The text is JSON that `JSON.parse` read, and nests at most
 * `maxDepth` levels, so the parser below can walk it unless the caller allowed a depth that the stack cannot hold.
 */
function repeatedProperty(text: string, maxDepth: number): Repeat | undefined {
  try {
    return findRepeat(parse(text, { mode: "json" }).body, "");
  } catch (error) {
    if (error instanceof RangeError) {
      throw new DataError(
        `The text nests deeper than the parser can read, and the limit of ${maxDepth} levels is too high.`,
      );
    }
    throw error;
  }
}

/**
 * Parses the text of a Statement, or of a batch of them, as JSON, and refuses an object that has a property twice.
 *
 * @remarks
 * `JSON.parse` keeps the last of two properties with one name and says nothing, so an LRS that reads a request with it cannot
 * obey the rule that it shall reject a Statement that uses a property more than once (4.2.1). A name is the same when its
 * characters are, whatever the escapes that write them. The size, the depth and the number of tokens are checked before the
 * text is parsed, and a property named `__proto__` is a property of the result and changes no prototype. The syntax tree that
 * the parser builds takes memory for each token and not for each byte, up to 250 bytes: `[0,0,0` and so on is a token for each
 * byte, so a text of 10 MiB would take over 1 GB. `maxTokens` bounds the tree, and a host with less memory than 300 MB, such as
 * a Cloudflare Worker, passes a smaller one.
 *
 * @param text - The text of a request or a file.
 * @param options - The limits.
 * @returns The parsed value, which `readStatement` or `validateStatements` reads.
 * @throws `DataError` when the text is longer, deeper or has more tokens than the limits, is not JSON, or has a property
 * twice, or when the options are not valid.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function readStatementJson(text: string, options?: ReadStatementJsonOptions): unknown {
  checkString(text, "The text");
  const {
    maxBytes = DEFAULT_MAX_BYTES,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxTokens = DEFAULT_MAX_TOKENS,
  } = parseWith(optionsSchema, options === undefined ? {} : options, "The options object");
  // A string of more units than the limit has more bytes than it, so the longer ones need no encoding.
  const bytes = text.length > maxBytes ? text.length : new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    throw new DataError(`The text has ${bytes} bytes or more, above the limit of ${maxBytes} bytes.`);
  }
  if (nestsDeeperThan(text, maxDepth)) {
    throw new DataError(`The text nests arrays and objects deeper than the limit of ${maxDepth} levels.`);
  }
  if (hasMoreTokensThan(text, maxTokens)) {
    throw new DataError(`The text has more than ${maxTokens} tokens, above the limit of the option maxTokens.`);
  }
  let value: unknown;
  try {
    // `JSON.parse` is the judge of the syntax of RFC 8259: the tree below accepts a tab inside a string, which it forbids.
    value = JSON.parse(text);
  } catch (error) {
    throw new DataError(`The text is not valid JSON: ${String(error)}.`);
  }
  const repeat = repeatedProperty(text, maxDepth);
  if (repeat !== undefined) {
    const where = repeat.path === "" ? "" : ` in ${repeat.path}`;
    throw new DataError(
      `The text has the property ${JSON.stringify(repeat.name)} twice${where}, at line ${repeat.line} column ${repeat.column}. An LRS rejects a property that occurs more than once.`,
    );
  }
  return value;
}
