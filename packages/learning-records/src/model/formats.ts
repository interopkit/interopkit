/** A `mailto` IRI with one address: `mailto:` and a local part and a domain that have no white space, comma, question mark or `@` of their own. */
const MAILTO = /^mailto:[^\s@,?]+@[^\s@,?]+$/u;

/** The SHA-1 hash as hexadecimal digits. */
const SHA1_HEX = /^[0-9a-fA-F]{40}$/u;

/** The SHA-2 hashes that FIPS 180-4 defines, as hexadecimal digits: 224, 256, 384 and 512 bits. */
const SHA2_HEX = /^(?:[0-9a-fA-F]{56}|[0-9a-fA-F]{64}|[0-9a-fA-F]{96}|[0-9a-fA-F]{128})$/u;

/** The characters of a token of RFC 9110 section 5.6.2. */
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";

/** An Internet media type with parameters, as RFC 9110 section 8.3.1 writes it. */
const MEDIA_TYPE = new RegExp(
  `^${TOKEN}/${TOKEN}(?:[ \\t]*;[ \\t]*${TOKEN}=(?:${TOKEN}|"(?:[^"\\\\]|\\\\.)*"))*$`,
  "u",
);

/** Tells whether text is a `mailto` IRI with one email address, the form of `mbox` (4.2.2.1). */
export function isMailtoIri(text: string): boolean {
  return MAILTO.test(text);
}

/** Tells whether text is a SHA-1 hash written as 40 hexadecimal digits, the form of `mbox_sha1sum` (4.2.2.1). */
export function isSha1Hex(text: string): boolean {
  return SHA1_HEX.test(text);
}

/** Tells whether text is a SHA-2 hash of 224, 256, 384 or 512 bits written as hexadecimal digits, the form of `sha2` (4.2.2.6). */
export function isSha2Hex(text: string): boolean {
  return SHA2_HEX.test(text);
}

/** Tells whether text is an Internet media type, such as `text/plain; charset=utf-8`, the form of `contentType` (4.2.2.6). */
export function isMediaType(text: string): boolean {
  return MEDIA_TYPE.test(text);
}
