import { hasMoreTokensThan } from "@interopkit/core/checks";

/**
 * Says whether a credential has more tokens of JSON than the JSON-LD processors may read, before any of them reads it: the work of
 * a processor grows with the square of the values of one property, so the tokens bound it as the characters cannot.
 *
 * @param credential - The credential, as JSON.
 * @param maxTokens - The most tokens of JSON.
 * @returns A sentence that names the limit and the option that sets it, or `undefined` when the credential is within it.
 */
export function processingProblem(credential: unknown, maxTokens: number): string | undefined {
  let text: string;
  try {
    text = JSON.stringify(credential);
  } catch {
    // JSON.stringify throws a TypeError for a cycle and for a BigInt, neither of which JSON has.
    return "The credential is not JSON.";
  }
  return hasMoreTokensThan(text, maxTokens)
    ? `The credential has more than the ${maxTokens} tokens of JSON that the option maxJsonLdTokens allows a JSON-LD processor.`
    : undefined;
}
