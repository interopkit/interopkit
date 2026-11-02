/** The alphabet of base64url (RFC 4648 section 5), in the order of the values of its characters. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** A text of the alphabet of base64url and nothing else: no padding, no white space. */
const BASE64URL = /^[A-Za-z0-9_-]*$/u;

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
 * @param text - The text.
 * @returns The bytes, or `undefined` when the text is not canonical base64url.
 */
export function decodeBase64url(text: string): Uint8Array | undefined {
  const rest = text.length % 4;
  if (rest === 1 || !BASE64URL.test(text)) return undefined;
  const unused = rest === 2 ? UNUSED_OF_TWO : rest === 3 ? UNUSED_OF_THREE : 0;
  if ((ALPHABET.indexOf(text.charAt(text.length - 1)) & unused) !== 0) return undefined;
  // The text is of the alphabet and of a length that holds bytes, so `atob` reads it.
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  // A loop over the code units, since a conversion with a callback makes a string of each.
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
