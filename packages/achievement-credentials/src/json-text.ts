import { DataError, LimitError } from "@interopkit/core";
import { findExceededJsonLimit, type JsonTextRefusals, MAX_JSON_DEPTH, nestsDeeperThan } from "@interopkit/core/checks";

/** What a text of JSON may be before it is parsed. */
export interface JsonLimits {
  /** The most levels that arrays and objects nest. */
  readonly maxDepth: number;
  /** The most tokens of JSON: the memory of a parse grows with the tokens and not with the bytes. */
  readonly maxTokens: number;
}

/**
 * Writes the sentences of the errors that `parseJsonText` of core throws for a text that came from a source the package does
 * not trust, in the words of the package.
 *
 * @param what - Names the text in the sentences, such as `The document`.
 * @param limits - The most levels and tokens that the text is parsed within.
 * @returns The sentences of a text that nests too deep, that has too many tokens, and that is not JSON.
 */
export function jsonRefusals(what: string, { maxDepth, maxTokens }: JsonLimits): JsonTextRefusals {
  return {
    depth: `${what} nests more than ${maxDepth} levels.`,
    tokens: `${what} has more than the ${maxTokens} tokens of JSON that it may have.`,
    syntax: () => `${what} is not JSON.`,
  };
}

/** What the text of a value passed as an object may be before anything reads the value. */
export interface TextLimits {
  /**
   * The most characters, which the option `maxInputBytes` sets.
   *
   * @defaultValue none
   */
  readonly maxInputBytes?: number;
  /**
   * The most levels that arrays and objects nest.
   *
   * @defaultValue `64`, `MAX_JSON_DEPTH` of core
   */
  readonly maxDepth?: number;
  /** The most tokens of JSON. */
  readonly maxTokens: number;
  /**
   * The name of the option that sets `maxTokens`, which the error names.
   *
   * @defaultValue `"maxTokens"`
   */
  readonly tokensOption?: string;
}

/**
 * Writes a value that a caller passed as an object into the text in which its size, levels and tokens are counted, and checks
 * the limits before anything reads the value: its characters first, then its levels and its tokens in the order of
 * `parseJsonText` of core, which refuses a value over both for its levels.
 *
 * @param value - The value.
 * @param limits - The most characters, levels and tokens.
 * @param what - Names the value in the sentences, such as `The credential`.
 * @returns The text.
 * @throws `LimitError` that names the limit the value is over: `maxInputBytes`, `maxDepth` or the option of the tokens.
 * @throws `DataError` when the value is not JSON: it holds itself or a BigInt, or it is undefined.
 */
export function textWithinLimits(value: unknown, limits: TextLimits, what: string): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    // JSON.stringify throws a TypeError for a cycle and for a BigInt, neither of which JSON has.
    throw new DataError(`${what} is not JSON.`, { cause: error });
  }
  if (text === undefined) throw new DataError(`${what} is not JSON.`);
  const { maxInputBytes, maxDepth = MAX_JSON_DEPTH, maxTokens, tokensOption = "maxTokens" } = limits;
  if (maxInputBytes !== undefined && text.length > maxInputBytes) {
    throw new LimitError(
      `${what} has ${text.length} characters, more than the ${maxInputBytes} that the option maxInputBytes allows.`,
      "maxInputBytes",
      maxInputBytes,
    );
  }
  const excess = findExceededJsonLimit(text, maxDepth, maxTokens);
  if (excess === "depth" || (excess === "tokens" && nestsDeeperThan(text, maxDepth))) {
    throw new LimitError(`${what} nests more than ${maxDepth} levels.`, "maxDepth", maxDepth);
  }
  if (excess === "tokens") {
    throw new LimitError(
      `${what} has more than the ${maxTokens} tokens of JSON that the option ${tokensOption} allows.`,
      tokensOption,
      maxTokens,
    );
  }
  return text;
}

/**
 * The most tokens of JSON in a credential that a JSON-LD processor reads unless the caller sets another limit. The processor adds
 * each value of a property after a search of the values that the property already holds, so its work grows with the square of
 * the values of one property, and `maxTokens` of a parse is far too generous for it: 20,000 values of one property take about
 * four seconds. The largest example of Open Badges 3.0 has 2,053 tokens, and `selective-disclosure` uses the same default.
 */
export const DEFAULT_MAX_JSON_LD_TOKENS = 20_000;
