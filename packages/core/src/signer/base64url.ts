/** How many bytes `String.fromCharCode` takes in one call, so that a long input does not overflow the stack. */
const CHUNK_BYTES = 8192;

/** Encodes bytes as base64url without padding (RFC 4648 section 5). */
export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK_BYTES));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
