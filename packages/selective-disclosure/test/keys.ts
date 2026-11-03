import type { Signer } from "@interopkit/core";
import { createCryptoKeySigner } from "@interopkit/core";

/** An issuer: the signer over a P-256 private key, and its public key as the JWK that a verifier resolved. */
export interface Issuer {
  readonly signer: Signer;
  readonly publicKeyJwk: JsonWebKey;
}

/** The verification method that the signers of the tests name. */
export const VERIFICATION_METHOD = "https://example.test/issuers/1#key-1";

/** Makes an issuer with a new key pair. */
export async function createIssuer(keyId: string = VERIFICATION_METHOD): Promise<Issuer> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    signer: createCryptoKeySigner(pair.privateKey, { algorithm: "ES256", keyId }),
    publicKeyJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}
