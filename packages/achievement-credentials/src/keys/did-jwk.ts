import { nestsDeeperThan } from "@interopkit/core/checks";
import { base64url } from "jose";
import { publicJwk } from "./jwk.js";

const PREFIX = "did:jwk:";

/** The most characters of a `did:jwk`: a public JWK of an RSA key of 8,192 bits written in base64url is under 1,500 characters. */
const MAX_DID_JWK_CHARS = 4096;

/** The most levels of the JWK that a `did:jwk` holds: a JWK is a flat object. */
const MAX_JWK_DEPTH = 2;

/** Tells whether a value is a `did:jwk`. */
export function isDidJwk(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Reads the public key that a `did:jwk` is made of: the DID holds the key and nothing else, so it needs no request.
 *
 * @returns The key, or `undefined` when the DID is too long, is not base64url of a JSON object, or holds a key that cannot
 * verify a credential.
 */
export function decodeDidJwk(did: string): JsonWebKey | undefined {
  const [encoded = "", ...rest] = did.slice(PREFIX.length).split("#");
  if (rest.length > 1 || encoded === "" || did.length > MAX_DID_JWK_CHARS) return undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(base64url.decode(encoded));
    if (nestsDeeperThan(text, MAX_JWK_DEPTH)) return undefined;
    return publicJwk(JSON.parse(text));
  } catch {
    return undefined;
  }
}
