import { DataError } from "@interopkit/core";
import { checkString, describe } from "@interopkit/core/checks";

// The grammar of a Permissions Policy allow list needs letters, digits, quoted keywords and origins, `*`, and `;` between
// directives; the pattern leaves out quotes of the other kind, brackets, commas and control characters.
const ALLOW_LIST = /^[A-Za-z0-9 ;*:/.'-]+$/u;

/**
 * Checks the `allow` attribute of the frame of a tool.
 *
 * @param value - The attribute.
 * @param label - Names the value in the error message, such as `The allow list of a tool`.
 * @throws `DataError` when it is not a non-empty string of the characters that a Permissions Policy allow list uses.
 */
export function checkAllowList(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  if (!ALLOW_LIST.test(value)) {
    throw new DataError(
      `${label} must be a Permissions Policy allow list of letters, digits, spaces and the characters ; * : / . ' -, found ${describe(value)}.`,
    );
  }
}
