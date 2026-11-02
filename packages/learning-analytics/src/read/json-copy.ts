import { DataError } from "@interopkit/core";
import { copyJson } from "@interopkit/core/checks";

/**
 * Copies a document that must be JSON, so that the schemas that read it see a value of bounded depth and the result shares
 * nothing with the input.
 *
 * @param value - The document, such as the parsed text of a request.
 * @param label - Names the document in the error message, such as `The entity`.
 * @returns The copy.
 * @throws `DataError` that says where the document is not JSON, or that it nests more than `MAX_JSON_DEPTH` levels, which the
 * recursive schemas could not read without exhausting the stack.
 */
export function copyDocument(value: unknown, label: string): unknown {
  const copy = copyJson(value, "");
  if ("problem" in copy) throw new DataError(`${label} is invalid: ${copy.problem}.`);
  return copy.value;
}
