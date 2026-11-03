import { createCryptoKeySigner, type Signer } from "@interopkit/core";
import { base58 } from "@scure/base";

/** The JOSE algorithm of a key, and so the kind of key: Ed25519 for `EdDSA`, P-256 for `ES256`. */
export type SigningAlgorithm = "EdDSA" | "ES256";

/** The multicodec prefix of an Ed25519 public key, as an unsigned varint (0xed). */
const ED25519_PUBLIC_KEY = [0xed, 0x01] as const;
/** The multicodec prefix of a compressed P-256 public key, as an unsigned varint (0x1200). */
const P256_PUBLIC_KEY = [0x80, 0x24] as const;
/** The first byte of a compressed point of P-256: 2 when `y` is even and 3 when it is odd. */
const COMPRESSED_EVEN = 0x02;
const COMPRESSED_ODD = 0x03;

/** A key that signs, and the forms in which an issuer publishes it. */
export interface SigningKey {
  /** The JOSE algorithm of the key. */
  readonly algorithm: SigningAlgorithm;
  /** The public key as a JWK, for a controller document. */
  readonly publicKeyJwk: JsonWebKey;
  /** The public key as a Multikey: base58btc multibase of the multicodec prefix and the key. */
  readonly multikey: string;
  /** The `did:key` that holds the public key. */
  readonly did: string;
  /** Makes the signer that names `keyId` as the key that verifies its signatures. */
  signer(keyId: string): Signer;
}

function bytesOf(base64url: string | undefined): Uint8Array {
  const base64 = (base64url ?? "").replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** Writes the public key of a JWK as a Multikey. */
function multikeyOf(algorithm: SigningAlgorithm, jwk: JsonWebKey): string {
  const x = bytesOf(jwk.x);
  const body =
    algorithm === "EdDSA"
      ? [...ED25519_PUBLIC_KEY, ...x]
      : [...P256_PUBLIC_KEY, (bytesOf(jwk.y).at(-1) ?? 0) % 2 === 0 ? COMPRESSED_EVEN : COMPRESSED_ODD, ...x];
  return `z${base58.encode(Uint8Array.from(body))}`;
}

/**
 * Makes a key that signs: Ed25519 for the `eddsa-rdfc-2022` cryptosuite, P-256 for JWTs and `ecdsa-sd-2023`. A host keeps its
 * keys in a KMS and signs through a `Signer`; this example generates them in memory.
 */
export async function createSigningKey(algorithm: SigningAlgorithm): Promise<SigningKey> {
  const pair =
    algorithm === "EdDSA"
      ? await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
      : await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const multikey = multikeyOf(algorithm, publicKeyJwk);
  return {
    algorithm,
    publicKeyJwk,
    multikey,
    did: `did:key:${multikey}`,
    signer: (keyId) => createCryptoKeySigner(pair.privateKey, { algorithm, keyId }),
  };
}
