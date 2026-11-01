import { isRecord } from "@interopkit/core/checks";
import { calculateJwkThumbprint } from "jose";

/** The members of a JWK that hold private key material (RFC 7518 sections 6.2.2, 6.3.2 and 6.4): a key that has one is refused. */
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"] as const;

/** The most characters of the base64url `n` of an RSA key: 8,192 bits. A larger modulus costs more to verify than any issuer needs. */
const MAX_RSA_MODULUS_CHARS = 1366;

/** The most characters of the base64url `e` of an RSA key: 32 bits. */
const MAX_RSA_EXPONENT_CHARS = 6;

/** The most characters of a base64url coordinate of an EC or OKP key: 66 bytes, the P-521 coordinate. */
const MAX_COORDINATE_CHARS = 88;

/** The curves of EC keys that a signature algorithm of the verification uses (RFC 7518 section 6.2.1.1). */
const EC_CURVES: ReadonlySet<string> = new Set(["P-256", "P-384", "P-521"]);

const BASE64URL = /^[A-Za-z0-9_-]+$/u;

/** Tells whether a member is base64url text of at most `limit` characters. */
function isEncoded(member: unknown, limit: number): member is string {
  return typeof member === "string" && member.length <= limit && BASE64URL.test(member);
}

/**
 * Reads a public key from a JWK that came from a document or a header, and keeps its public members only.
 *
 * @remarks
 * A key that holds private material, that is meant for encryption (`use` other than `sig`, `key_ops` without `verify`), or
 * that is none of RSA, EC on a curve of JOSE or OKP on Ed25519 is not a key for verifying a credential, and the result is
 * `undefined`. The size of an RSA modulus is limited before any verification uses it.
 */
export function publicJwk(input: unknown): JsonWebKey | undefined {
  if (!isRecord(input)) return undefined;
  if (PRIVATE_MEMBERS.some((member) => member in input)) return undefined;
  if (input.use !== undefined && input.use !== "sig") return undefined;
  if (input.key_ops !== undefined && !(Array.isArray(input.key_ops) && input.key_ops.includes("verify"))) {
    return undefined;
  }
  const algorithm = typeof input.alg === "string" ? { alg: input.alg } : {};
  if (input.kty === "RSA" && isEncoded(input.n, MAX_RSA_MODULUS_CHARS) && isEncoded(input.e, MAX_RSA_EXPONENT_CHARS)) {
    return { kty: "RSA", n: input.n, e: input.e, ...algorithm };
  }
  if (
    input.kty === "EC" &&
    typeof input.crv === "string" &&
    EC_CURVES.has(input.crv) &&
    isEncoded(input.x, MAX_COORDINATE_CHARS) &&
    isEncoded(input.y, MAX_COORDINATE_CHARS)
  ) {
    return { kty: "EC", crv: input.crv, x: input.x, y: input.y, ...algorithm };
  }
  if (input.kty === "OKP" && input.crv === "Ed25519" && isEncoded(input.x, MAX_COORDINATE_CHARS)) {
    return { kty: "OKP", crv: "Ed25519", x: input.x, ...algorithm };
  }
  return undefined;
}

/** Returns the RFC 7638 thumbprint of a public key, with SHA-256, as base64url. */
export async function thumbprintOf(key: JsonWebKey): Promise<string> {
  return await calculateJwkThumbprint({ ...key }, "sha256");
}

/** Returns the URI of the thumbprint of a key (RFC 9278), which names a key that has no identifier of its own. */
export function thumbprintUri(thumbprint: string): string {
  return `urn:ietf:params:oauth:jwk-thumbprint:sha-256:${thumbprint}`;
}
