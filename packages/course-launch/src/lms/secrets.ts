/** The bytes of a secret of a fetch URL or of an authorization token: 256 bits, more than any guess can reach. */
const SECRET_BYTES = 32;

/** Writes bytes in base64url without padding. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/**
 * Makes a secret of 32 random bytes in base64url, from the generator of Web Crypto: a host or a test cannot replace it, so a
 * secret is never predictable.
 */
export function newSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

/** Returns the SHA-256 of a secret in base64url, which a record keeps instead of the secret. */
export async function hashOf(secret: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))));
}

/** Tells whether two hashes are equal, in a time that does not depend on where they differ. */
export function sameHash(given: string, kept: string): boolean {
  let difference = given.length ^ kept.length;
  for (let index = 0; index < kept.length; index += 1) {
    difference |= kept.charCodeAt(index) ^ (given.charCodeAt(index) || 0);
  }
  return difference === 0;
}
