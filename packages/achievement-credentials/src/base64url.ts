/** The alphabet of base64url (RFC 4648 section 5), in the order of the values of its characters. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** The units of ASCII, beyond which no character is of the alphabet. */
const ASCII = 128;
/** The value of a code unit that is not of the alphabet. */
const NOT_OF_THE_ALPHABET = -1;
/** The value of each character of the alphabet by its code unit. */
const VALUES = Int8Array.from({ length: ASCII }, (_, unit) => {
  const value = ALPHABET.indexOf(String.fromCharCode(unit));
  return value === -1 ? NOT_OF_THE_ALPHABET : value;
});

/** The characters of a group of base64, and the bytes that they hold: four characters of six bits are three bytes. */
const CHARACTERS_PER_GROUP = 4;
const BYTES_PER_GROUP = 3;
const BITS_PER_CHARACTER = 6;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;
/** The bits that the reading keeps: those of the last two characters, which hold at most one byte not yet written. */
const HELD_MASK = 0xfff;

/** The bits of the last character that no byte holds when the length of the text is 2 more than a multiple of 4. */
const UNUSED_OF_TWO = 0b1111;
/** The bits of the last character that no byte holds when the length of the text is 3 more than a multiple of 4. */
const UNUSED_OF_THREE = 0b11;

/**
 * Decodes base64url without padding to bytes, when the text is the one canonical spelling of them (RFC 7515 section 2), as the
 * parts of a compact JWS must be: of the alphabet of base64url, of a length that is not one more than a multiple of four, and
 * with the bits of its last character that no byte holds at zero. Otherwise one signature or payload would have several
 * spellings.
 *
 * @remarks
 * The text is read once, character by character into the bytes, with no string made on the way: a payload of a few hundred
 * kilobytes otherwise took three copies of itself.
 *
 * @param text - The text.
 * @returns The bytes, or `undefined` when the text is not canonical base64url.
 */
export function decodeBase64url(text: string): Uint8Array | undefined {
  const rest = text.length % CHARACTERS_PER_GROUP;
  if (rest === 1) return undefined;
  const bytes = new Uint8Array(Math.floor((text.length * BYTES_PER_GROUP) / CHARACTERS_PER_GROUP));
  let bits = 0;
  let held = 0;
  let written = 0;
  for (let index = 0; index < text.length; index += 1) {
    // A code unit beyond the table has no value, as a character that the table marks as not of the alphabet has none.
    const value = VALUES[text.charCodeAt(index)];
    if (value === undefined || value === NOT_OF_THE_ALPHABET) return undefined;
    bits = ((bits << BITS_PER_CHARACTER) | value) & HELD_MASK;
    held += BITS_PER_CHARACTER;
    if (held >= BITS_PER_BYTE) {
      held -= BITS_PER_BYTE;
      bytes[written] = (bits >> held) & BYTE_MASK;
      written += 1;
    }
  }
  const unused = rest === 2 ? UNUSED_OF_TWO : rest === 3 ? UNUSED_OF_THREE : 0;
  return (bits & unused) === 0 ? bytes : undefined;
}
