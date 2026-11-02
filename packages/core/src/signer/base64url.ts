/** The characters of base64url (RFC 4648 section 5) in the order of their values. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Turns the codes of the characters, which are ASCII, into one string. */
const DECODER = new TextDecoder();

/** The bytes of a group of base64, and the characters that it is written with: 24 bits as four characters of six. */
const BYTES_PER_GROUP = 3;
const CHARACTERS_PER_GROUP = 4;
/** The places of the bytes of a group, and of its characters, in its 24 bits. */
const FIRST_BYTE = 16;
const SECOND_BYTE = 8;
const FIRST_CHARACTER = 18;
const SECOND_CHARACTER = 12;
const THIRD_CHARACTER = 6;
/** The bits of one character. */
const CHARACTER_MASK = 0b11_1111;

/**
 * Encodes bytes as base64url without padding (RFC 4648 section 5).
 *
 * @remarks
 * The characters are written as bytes and decoded once, in time linear in the input: a string built from the bytes as the
 * arguments of a call, and its encoding by `btoa`, took longer than the signature of a payload of two kilobytes.
 */
export function encodeBase64Url(bytes: Uint8Array): string {
  const characters = new Uint8Array(Math.ceil((bytes.length * CHARACTERS_PER_GROUP) / BYTES_PER_GROUP));
  const whole = bytes.length - (bytes.length % BYTES_PER_GROUP);
  let written = 0;
  for (let index = 0; index < whole; index += BYTES_PER_GROUP) {
    const group =
      ((bytes[index] ?? 0) << FIRST_BYTE) | ((bytes[index + 1] ?? 0) << SECOND_BYTE) | (bytes[index + 2] ?? 0);
    characters[written] = ALPHABET.charCodeAt(group >> FIRST_CHARACTER);
    characters[written + 1] = ALPHABET.charCodeAt((group >> SECOND_CHARACTER) & CHARACTER_MASK);
    characters[written + 2] = ALPHABET.charCodeAt((group >> THIRD_CHARACTER) & CHARACTER_MASK);
    characters[written + 3] = ALPHABET.charCodeAt(group & CHARACTER_MASK);
    written += CHARACTERS_PER_GROUP;
  }
  // The last one or two bytes, padded with zero bits, take one character more than they have bytes, and no padding.
  const rest = bytes.length - whole;
  if (rest > 0) {
    const group = ((bytes[whole] ?? 0) << FIRST_BYTE) | ((bytes[whole + 1] ?? 0) << SECOND_BYTE);
    characters[written] = ALPHABET.charCodeAt(group >> FIRST_CHARACTER);
    characters[written + 1] = ALPHABET.charCodeAt((group >> SECOND_CHARACTER) & CHARACTER_MASK);
    if (rest === 2) characters[written + 2] = ALPHABET.charCodeAt((group >> THIRD_CHARACTER) & CHARACTER_MASK);
  }
  return DECODER.decode(characters);
}
