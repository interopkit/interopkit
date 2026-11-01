const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const COLON = 0x3a;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const SPACE = 0x20;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/** Tells whether a code unit is one of the six structural characters of RFC 8259, section 2. */
function isStructural(unit: number): boolean {
  return (
    unit === COMMA ||
    unit === COLON ||
    unit === OPEN_BRACKET ||
    unit === CLOSE_BRACKET ||
    unit === OPEN_BRACE ||
    unit === CLOSE_BRACE
  );
}

/** Tells whether a code unit is white space between the tokens of JSON (RFC 8259, section 2). */
function isWhiteSpace(unit: number): boolean {
  return unit === SPACE || unit === TAB || unit === LINE_FEED || unit === CARRIAGE_RETURN;
}

/** Returns the index of the quote that ends the string which opens at `start`, or the length of the text when none does. */
function endOfString(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    // A backslash escapes the next unit, which may be a quote.
    if (unit === BACKSLASH) index += 1;
    else if (unit === QUOTE) return index;
  }
  return text.length;
}

/**
 * Tells whether a text of JSON has more tokens than a limit, reading no further than the first token above it. A token is a
 * structural character, a string, or a number or one of `true`, `false` and `null`.
 *
 * @remarks
 * Nothing is built, and the text need not be valid JSON, so the count can come before the parser. For valid JSON it is the
 * number of tokens that the tokenizer of `momoa` makes, which the syntax tree has a node or two for.
 *
 * @param text - The text.
 * @param maxTokens - The most tokens that are allowed.
 * @returns Whether the text has more.
 */
export function hasMoreTokensThan(text: string, maxTokens: number): boolean {
  let tokens = 0;
  let inLiteral = false;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === QUOTE) {
      index = endOfString(text, index);
      inLiteral = false;
    } else if (isStructural(unit)) {
      inLiteral = false;
    } else if (isWhiteSpace(unit)) {
      inLiteral = false;
      continue;
    } else if (inLiteral) {
      // The run of a number or a literal was counted at its first character.
      continue;
    } else {
      inLiteral = true;
    }
    tokens += 1;
    if (tokens > maxTokens) return true;
  }
  return false;
}
