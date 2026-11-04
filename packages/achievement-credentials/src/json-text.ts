import { DataError, LimitError } from "@interopkit/core";
import { findExceededJsonLimit, hasMoreTokensThan } from "@interopkit/core/checks";

/** What a text of JSON may be before it is parsed. */
export interface JsonLimits {
  /** The most levels that arrays and objects nest. */
  readonly maxDepth: number;
  /** The most tokens of JSON: the memory of a parse grows with the tokens and not with the bytes. */
  readonly maxTokens: number;
}

/** Why a text of JSON is refused: the sentence, and the limit with its value when a limit refuses it. */
export interface JsonTextRefusal {
  readonly reason: string;
  /** The name of the limit that the text is over and its value; none when the text is within the limits and not JSON. */
  readonly exceeded?: { readonly limit: string; readonly maximum: number };
}

/**
 * Says which limit of tokens or levels a text of JSON is over, or that it is over none: the tokens first, which bound the memory
 * of the tree, then the levels, which bound the stack of a parser that recurses.
 */
function overLimit(text: string, limits: JsonLimits, what: string): Required<JsonTextRefusal> | undefined {
  // One reading finds the first limit that the text passes. The tokens are refused before the levels, so a text that passes
  // the levels first is read on for its tokens.
  const excess = findExceededJsonLimit(text, limits.maxDepth, limits.maxTokens);
  if (excess === "tokens" || (excess === "depth" && hasMoreTokensThan(text, limits.maxTokens))) {
    const reason = `${what} has more than the ${limits.maxTokens} tokens of JSON that it may have.`;
    return { reason, exceeded: { limit: "maxTokens", maximum: limits.maxTokens } };
  }
  if (excess !== "depth") return undefined;
  const reason = `${what} nests more than ${limits.maxDepth} levels.`;
  return { reason, exceeded: { limit: "maxDepth", maximum: limits.maxDepth } };
}

/** The error of a text that a check refused: a `LimitError` when a limit refused it, and a `DataError` otherwise. */
export function refusalError({ reason, exceeded }: JsonTextRefusal): DataError {
  return exceeded === undefined ? new DataError(reason) : new LimitError(reason, exceeded.limit, exceeded.maximum);
}

/**
 * Parses a text of JSON that came from a source the package does not trust, after it has checked what the parse would cost:
 * the tokens first, which bound the memory of the tree, then the levels, which bound the stack of a parser that recurses.
 *
 * @param text - The text.
 * @param limits - The most levels and tokens.
 * @param what - Names the text in the sentence, such as `The document`.
 * @returns The value, or the sentence that says that the text is not JSON, or which limit it is over with that limit.
 */
export function parseJsonText(
  text: string,
  limits: JsonLimits,
  what: string,
): { readonly value: unknown } | JsonTextRefusal {
  const over = overLimit(text, limits, what);
  if (over !== undefined) return over;
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { reason: `${what} is not JSON.` };
  }
}

/** What the text of a value may be before anything reads the value. */
export interface TextLimits extends JsonLimits {
  /** The most characters. */
  readonly maxCharacters: number;
}

/**
 * Writes a value that a caller passed as an object into the text in which its size, tokens and levels are counted, and checks
 * the three limits before anything reads the value.
 *
 * @param value - The value.
 * @param limits - The most characters, tokens and levels.
 * @param what - Names the value in the sentence, such as `The credential`.
 * @returns The text, or the sentence that says which limit the value is over or that it is not JSON.
 */
export function textWithinLimits(
  value: unknown,
  limits: TextLimits,
  what: string,
): { readonly text: string } | { readonly reason: string } {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    // JSON.stringify throws a TypeError for a cycle and for a BigInt, neither of which JSON has.
    return { reason: `${what} is not JSON.` };
  }
  if (text === undefined) return { reason: `${what} is not JSON.` };
  if (text.length > limits.maxCharacters) {
    return { reason: `${what} has ${text.length} characters, more than the ${limits.maxCharacters} that it may have.` };
  }
  const over = overLimit(text, limits, what);
  return over === undefined ? { text } : { reason: over.reason };
}

/**
 * The most tokens of JSON in a credential that a JSON-LD processor reads unless the caller sets another limit. The processor adds
 * each value of a property after a search of the values that the property already holds, so its work grows with the square of
 * the values of one property, and `maxTokens` of a parse is far too generous for it: 20,000 values of one property take about
 * four seconds. The largest example of Open Badges 3.0 has 2,053 tokens, and `selective-disclosure` uses the same default.
 */
export const DEFAULT_MAX_JSON_LD_TOKENS = 20_000;
