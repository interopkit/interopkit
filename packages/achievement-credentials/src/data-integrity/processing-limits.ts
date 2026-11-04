import { DataError, LimitError } from "@interopkit/core";
import { findExceededJsonLimit, hasMoreTokensThan, MAX_JSON_DEPTH } from "@interopkit/core/checks";

/**
 * Says whether a credential has more tokens of JSON than the JSON-LD processors may read, or nests deeper than they recurse,
 * before any of them reads it or anything copies it: the work of a processor grows with the square of the values of one property,
 * so the tokens bound it as the characters cannot, and a copy and a processor recurse once for each level.
 *
 * @param credential - The credential, as JSON.
 * @param maxTokens - The most tokens of JSON.
 * @returns The error that refuses the credential: a `LimitError` that names the limit, and the option that sets the tokens,
 * or a `DataError` when it is not JSON; `undefined` when the credential is within both limits.
 */
export function processingProblem(credential: unknown, maxTokens: number): DataError | undefined {
  let text: string;
  try {
    text = JSON.stringify(credential);
  } catch (error) {
    // JSON.stringify throws a TypeError for a cycle and for a BigInt, neither of which JSON has.
    return new DataError("The credential is not JSON.", { cause: error });
  }
  // One reading finds the first limit that the text passes. The tokens are refused before the levels, so a text that passes
  // the levels first is read on for its tokens.
  const excess = findExceededJsonLimit(text, MAX_JSON_DEPTH, maxTokens);
  if (excess === "tokens" || (excess === "depth" && hasMoreTokensThan(text, maxTokens))) {
    return new LimitError(
      `The credential has more than the ${maxTokens} tokens of JSON that the option maxJsonLdTokens allows a JSON-LD processor.`,
      "maxJsonLdTokens",
      maxTokens,
    );
  }
  if (excess !== "depth") return undefined;
  return new LimitError(`The credential nests more than ${MAX_JSON_DEPTH} levels of JSON.`, "maxDepth", MAX_JSON_DEPTH);
}
