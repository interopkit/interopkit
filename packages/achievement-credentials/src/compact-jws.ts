/**
 * The form of a compact JWS (RFC 7515 section 7.1): three parts of base64url characters separated by dots. The payload is empty
 * when it is detached (RFC 7515 appendix F), which the schemas of the model accept and `isCompactJws` does not.
 */
export const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$/u;

/**
 * Tells whether a text is a compact JWS that carries its payload: of the form of `COMPACT_JWS`, with a payload that is not
 * empty. The characters of the parts are checked, and not whether they are canonical base64url, which `decodeBase64url` tells.
 *
 * @param text - The text.
 */
export function isCompactJws(text: string): boolean {
  // The first and the last part are not empty, so two dots side by side are an empty payload.
  return COMPACT_JWS.test(text) && !text.includes("..");
}
