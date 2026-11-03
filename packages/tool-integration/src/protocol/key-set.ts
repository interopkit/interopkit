import { DataError, type Signer } from "@interopkit/core";
import { checkNonEmptyString, checkRecord, checkString, describe, isRecord } from "@interopkit/core/checks";
import { buildJsonResponse, type HttpRequest, type HttpResponse } from "@interopkit/core/http";
import { base64url } from "jose";
import { APPROVED_ALGORITHMS } from "./claims/index.js";
import { MIN_RSA_MODULUS_BITS } from "./keys.js";

/** The keys of one party: the signer of its tokens, and the public keys it publishes. */
export interface KeySet {
  /** Signs with one of `APPROVED_ALGORITHMS`; its `keyId` is the `kid` of one of the public keys. */
  readonly signer: Signer;
  /**
   * The public keys: RSA keys of at least 2,048 bits and elliptic curve keys on P-256, P-384 or P-521, each with a `kid` that
   * no other key has. The current key and any kept for the overlap of a rotation.
   */
  readonly publicKeys: readonly JsonWebKey[];
}

/** The curve that each elliptic curve algorithm signs on (RFC 7518 section 3.4). */
const CURVE_OF: Readonly<Record<string, string>> = { ES256: "P-256", ES384: "P-384", ES512: "P-521" };
const CURVES: readonly string[] = Object.values(CURVE_OF);
/** The members of a JWK that hold a private or secret key (RFC 7518 sections 6.2.2, 6.3.2 and 6.4). */
const PRIVATE_MEMBERS: readonly string[] = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];

/** Returns the bits of the modulus of an RSA public key, or 0 when the key has none. */
function modulusBits(key: Readonly<Record<string, unknown>>): number {
  if (typeof key.n !== "string") return 0;
  let bytes: Uint8Array;
  try {
    bytes = base64url.decode(key.n);
  } catch {
    // A modulus that is not base64url is not a key.
    return 0;
  }
  const start = bytes.findIndex((byte) => byte !== 0);
  if (start === -1) return 0;
  return (bytes.length - start - 1) * 8 + (32 - Math.clz32(bytes[start] ?? 0));
}

/** Checks one public key of a key set and returns its `kid`. */
function checkPublicKey(key: unknown, index: number): string {
  const label = `The public key ${index} of the key set`;
  checkRecord(key, `${label} must be an object`);
  checkString(key.kid, `${label} must have a kid, which`);
  const privateMember = PRIVATE_MEMBERS.find((member) => member in key);
  if (privateMember !== undefined) {
    throw new DataError(
      `${label} must be a public key, and it has the member ${describe(privateMember)} of a private key.`,
    );
  }
  if (key.kty === "RSA") {
    if (modulusBits(key) < MIN_RSA_MODULUS_BITS) {
      throw new DataError(
        `${label} must be an RSA key of at least ${MIN_RSA_MODULUS_BITS} bits (RFC 7518 section 3.3).`,
      );
    }
  } else if (key.kty === "EC") {
    if (typeof key.crv !== "string" || !CURVES.includes(key.crv)) {
      throw new DataError(`${label} must be on one of ${CURVES.join(", ")}, found ${describe(key.crv)}.`);
    }
  } else {
    throw new DataError(`${label} must be an RSA or an EC key, found the type ${describe(key.kty)}.`);
  }
  return key.kid;
}

/**
 * Checks a signer of LTI tokens as a host passes it from JavaScript: an approved algorithm, a function `sign`, and a `keyId`,
 * which every token names as its `kid` (Security Framework 1.1 sections 6.3 and 7.2).
 *
 * @param label - Names the signer in the error message, such as `The signer of the key set`.
 * @throws `DataError` when it is not.
 */
export function checkLtiSigner(value: unknown, label: string): asserts value is Signer {
  checkRecord(value, `${label} must be an object`);
  const { algorithm } = value;
  const approved: readonly unknown[] = APPROVED_ALGORITHMS;
  if (typeof algorithm !== "string" || !approved.includes(algorithm)) {
    throw new DataError(
      `The algorithm of ${label.toLowerCase()} must be one of ${APPROVED_ALGORITHMS.join(", ")} (Security Framework section 7.2), found ${describe(algorithm)}.`,
    );
  }
  if (typeof value.sign !== "function") throw new DataError(`${label} must have a function sign.`);
  checkNonEmptyString(value.keyId, `The keyId of ${label.toLowerCase()}`);
}

/**
 * Checks a key set as a host passes it from JavaScript, and that its signer can sign with its keys.
 *
 * @remarks
 * Security Framework 1.1 section 6.3 has every key identified by a `kid` that no other key of the issuer reuses; section 7.2
 * approves the algorithms.
 *
 * @throws `DataError` when it is not a signer with an approved algorithm and a `keyId` that names one of the public keys, and
 * a list of public keys that are RSA keys of at least 2,048 bits or elliptic curve keys on an approved curve, public only,
 * with different `kid`s; or when the type or the curve of the signer's key does not fit its algorithm.
 */
export function checkKeySet(value: unknown): asserts value is KeySet {
  checkRecord(value, "The key set must be an object");
  const { signer, publicKeys } = value;
  checkLtiSigner(signer, "The signer of the key set");
  const { algorithm } = signer;
  if (!Array.isArray(publicKeys) || publicKeys.length === 0) {
    throw new DataError("The public keys of the key set must be a list of at least one key.");
  }
  const keyIds = publicKeys.map(checkPublicKey);
  const duplicate = keyIds.find((keyId, index) => keyIds.indexOf(keyId) !== index);
  if (duplicate !== undefined) {
    throw new DataError(
      `The public keys of the key set must have different kids, and ${describe(duplicate)} is used twice (Security Framework section 6.3).`,
    );
  }
  const signing = publicKeys[keyIds.indexOf(signer.keyId ?? "")];
  if (!isRecord(signing)) {
    throw new DataError(
      `The keyId of the signer must be the kid of one of the public keys, found ${describe(signer.keyId)}.`,
    );
  }
  const curve = CURVE_OF[algorithm];
  const fits = curve === undefined ? signing.kty === "RSA" : signing.kty === "EC" && signing.crv === curve;
  if (!fits) {
    throw new DataError(`The key ${describe(signer.keyId)} does not fit the algorithm ${algorithm} of the signer.`);
  }
}

/**
 * Answers a request for the key set of a party (Security Framework section 6.3, RFC 7517 section 5): a GET with the public
 * keys as JSON and `Cache-Control: public, max-age`, a HEAD with the same headers and no body, and any other method with 405 and
 * `Allow: GET, HEAD`. The caller has checked the key set.
 *
 * @param request - The request, which `checkHttpRequest` has accepted.
 * @param keys - The key set.
 * @param maxAgeSeconds - How long a reader may cache the set.
 */
export function keySetResponse(request: HttpRequest, keys: KeySet, maxAgeSeconds: number): HttpResponse {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return { status: 405, headers: { allow: "GET, HEAD" }, body: "" };
  }
  const response = buildJsonResponse(
    200,
    { keys: keys.publicKeys },
    { "cache-control": `public, max-age=${maxAgeSeconds}` },
  );
  return request.method === "HEAD" ? { ...response, body: "" } : response;
}
