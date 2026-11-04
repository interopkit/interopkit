import { DataError, LimitError } from "@interopkit/core";
import { findExceededJsonLimit, isRecord, nestsDeeperThan } from "@interopkit/core/checks";
import type { Extensions } from "../../model/index.js";

/** Throws on bytes that are not UTF-8, where the default decoder would replace them. */
const DECODER = new TextDecoder("utf-8", { fatal: true });

/**
 * Reads bytes as a JSON object, within a depth and a number of tokens, which are checked before the text is parsed.
 *
 * @param what - Names the bytes in a sentence, such as `The body`.
 * @throws `LimitError` when they nest too deep or have too many tokens.
 * @throws `DataError` when they are not UTF-8 or JSON, or hold something other than an object.
 */
export function readObject(
  bytes: Uint8Array,
  what: string,
  { maxDepth, maxTokens }: { readonly maxDepth: number; readonly maxTokens: number },
): Extensions {
  let text: string;
  try {
    text = DECODER.decode(bytes);
  } catch (error) {
    throw new DataError(`${what} must be a JSON object, and it holds bytes that are not UTF-8.`, { cause: error });
  }
  // The depth is refused before the tokens, as the text of a request is, so a text that passes the tokens first is read on.
  const excess = findExceededJsonLimit(text, maxDepth, maxTokens);
  if (excess === "depth" || (excess === "tokens" && nestsDeeperThan(text, maxDepth))) {
    throw new LimitError(
      `${what} must be a JSON object, and it nests deeper than the limit of ${maxDepth} levels.`,
      "maxDepth",
      maxDepth,
    );
  }
  if (excess === "tokens") {
    throw new LimitError(
      `${what} must be a JSON object, and it has more than ${maxTokens} tokens, the limit.`,
      "maxTokens",
      maxTokens,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new DataError(`${what} must be a JSON object, and it is not valid JSON.`, { cause: error });
  }
  if (!isRecord(value)) throw new DataError(`${what} must be a JSON object, and it is not an object.`);
  return value as Extensions;
}

/** Merges the top-level properties of a JSON object into another: the properties of the second replace those of the first. */
export function merge(existing: Extensions, posted: Extensions): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ ...existing, ...posted }));
}
