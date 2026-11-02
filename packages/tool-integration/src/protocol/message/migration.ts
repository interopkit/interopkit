import type { MessageBase } from "./model.js";

/** What the signature of the `oauth_consumer_key` covers (LTI Migration Guide, `oauth_consumer_key_sign`). */
export interface ConsumerKeyParts {
  /** The `oauth_consumer_key` of the LTI 1.1 integration. */
  readonly consumerKey: string;
  /** The `deployment_id` of the message. */
  readonly deploymentId: string;
  /** The `iss` of the message. */
  readonly issuer: string;
  /** The client identifier of the tool, which the message names in `aud`. */
  readonly clientId: string;
  /** The `exp` of the message. */
  readonly expiresAt: number;
  /** The `nonce` of the message. */
  readonly nonce: string;
}

const encoder = new TextEncoder();

/** Imports the LTI 1.1 shared secret as the key of the HMAC. */
function secretKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Joins the parts with `&`, in the order of the Migration Guide, with no trailing `&`. */
function baseString(parts: ConsumerKeyParts): Uint8Array<ArrayBuffer> {
  const { consumerKey, deploymentId, issuer, clientId, expiresAt, nonce } = parts;
  return encoder.encode([consumerKey, deploymentId, issuer, clientId, expiresAt, nonce].join("&"));
}

/**
 * Signs the consumer key of an LTI 1.1 integration: the base64 of the HMAC-SHA256 of its parts, keyed by the shared secret
 * of LTI 1.1, so that a tool can tell that the platform holds the secret.
 *
 * @see {@link https://standards.1edtech.org/lti/guides/migration/migration-guide | LTI Migration Guide, oauth_consumer_key_sign}
 * @param parts - What the signature covers.
 * @param secret - The shared secret of the LTI 1.1 integration, in UTF-8.
 * @returns The signature, in base64 with padding.
 */
export async function signConsumerKey(parts: ConsumerKeyParts, secret: string): Promise<string> {
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await secretKey(secret), baseString(parts)));
  return btoa(String.fromCharCode(...signature));
}

/** Decodes standard base64 with padding, and nothing else: another spelling of the same bytes is not the signature. */
function decodeBase64(text: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    return btoa(String.fromCharCode(...bytes)) === text ? bytes : undefined;
  } catch {
    // `atob` throws for a character outside the alphabet.
    return undefined;
  }
}

/**
 * Tells whether the `lti1p1` claim of a message carries a signature of its consumer key that the host's LTI 1.1 secret
 * makes. The comparison is by the HMAC check of Web Crypto, which takes the same time wherever the signatures differ.
 *
 * @param message - A message read by `readMessage`, whose `claims` hold the `exp` and the `nonce`.
 * @param secret - The shared secret of the LTI 1.1 integration with that consumer key.
 * @returns `true` when the claim has a signature and it matches; `false` when the claim has none, does not match, or
 * cannot be checked.
 */
export async function verifyMigration(message: MessageBase, secret: string): Promise<boolean> {
  const { migration, claims } = message;
  const { exp, nonce } = claims;
  if (migration?.oauthConsumerKeySign === undefined || typeof exp !== "number" || typeof nonce !== "string")
    return false;
  const signature = decodeBase64(migration.oauthConsumerKeySign);
  if (signature === undefined) return false;
  const parts = {
    consumerKey: migration.oauthConsumerKey,
    deploymentId: message.deploymentId,
    issuer: message.issuer,
    clientId: message.clientId,
    expiresAt: exp,
    nonce,
  };
  return crypto.subtle.verify("HMAC", await secretKey(secret), signature, baseString(parts));
}
