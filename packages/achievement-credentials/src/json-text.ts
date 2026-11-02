import { hasMoreTokensThan, nestsDeeperThan } from "@interopkit/core/checks";

/** What a text of JSON may be before it is parsed. */
export interface JsonLimits {
  /** The most levels that arrays and objects nest. */
  readonly maxDepth: number;
  /** The most tokens of JSON: the memory of a parse grows with the tokens and not with the bytes. */
  readonly maxTokens: number;
}

/**
 * Parses a text of JSON that came from a source the package does not trust, after it has checked what the parse would cost:
 * the tokens first, which bound the memory of the tree, then the levels, which bound the stack of a parser that recurses.
 *
 * @param text - The text.
 * @param limits - The most levels and tokens.
 * @param what - Names the text in the sentence, such as `The document`.
 * @returns The value, or the sentence that says which limit the text is over or that it is not JSON.
 */
export function parseJsonText(
  text: string,
  limits: JsonLimits,
  what: string,
): { readonly value: unknown } | { readonly reason: string; readonly overLimit: boolean } {
  if (hasMoreTokensThan(text, limits.maxTokens)) {
    return {
      reason: `${what} has more than the ${limits.maxTokens} tokens of JSON that it may have.`,
      overLimit: true,
    };
  }
  if (nestsDeeperThan(text, limits.maxDepth)) {
    return { reason: `${what} nests more than ${limits.maxDepth} levels.`, overLimit: true };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { reason: `${what} is not JSON.`, overLimit: false };
  }
}
