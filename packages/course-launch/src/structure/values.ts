/** Tells whether a code unit is white space of XML: a space, a tab, a carriage return or a line feed. */
function isSpaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a;
}

/**
 * Removes the white space that leads and trails a value, as cmi5 asks of every value of a course structure (13.1). The white
 * space is that of XML, so a no-break space stays. A loop and not a pattern, whose search for trailing space would take time
 * in the square of a long run of spaces inside the text.
 */
export function trimSpace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isSpaceCode(text.charCodeAt(start))) start += 1;
  while (end > start && isSpaceCode(text.charCodeAt(end - 1))) end -= 1;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

/** Tells whether a text is white space alone, which a parent of elements may hold between them. */
export function isSpace(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (!isSpaceCode(text.charCodeAt(index))) return false;
  }
  return true;
}

/** An `xs:language`, the type of the `lang` of a `langstring`. */
const LANGUAGE = /^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/u;

/** Tells whether a trimmed value is an `xs:language`. */
export function isLanguage(text: string): boolean {
  return LANGUAGE.test(text);
}

/** An `xs:decimal`: digits with an optional sign and fraction, and no exponent. */
const DECIMAL = /^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))$/u;

/** The most decimal places of a mastery score, which cmi5 gives "up to 4 decimal places of precision" (13.1.4). */
const MASTERY_SCORE_DECIMALS = 4;

/** What reading a mastery score gives: its value, or why it is not one. */
export type MasteryScore =
  | { readonly value: number }
  | { readonly problem: "not-decimal" | "out-of-range" | "too-precise" };

/**
 * Reads a trimmed mastery score: an `xs:decimal` from 0 to 1 with at most four decimal places that are not trailing zeros.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#au_meta_data | cmi5, 13.1.4 AU Metadata}
 */
export function readMasteryScore(text: string): MasteryScore {
  const match = DECIMAL.exec(text);
  if (match === null) return { problem: "not-decimal" };
  const value = Number(text);
  if (value < 0 || value > 1) return { problem: "out-of-range" };
  const fraction = match[1] ?? match[2] ?? "";
  let places = fraction.length;
  while (places > 0 && fraction[places - 1] === "0") places -= 1;
  if (places > MASTERY_SCORE_DECIMALS) return { problem: "too-precise" };
  // A negative zero is zero, and JSON writes it so.
  return { value: value === 0 ? 0 : value };
}
