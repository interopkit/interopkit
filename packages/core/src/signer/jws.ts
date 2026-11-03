import type { CallOptions } from "../call-options.js";
import { checkAbortSignal, checkRecord, describe, isRecord } from "../checks.js";
import { DataError } from "../errors.js";
import { untilAborted } from "../until-aborted.js";
import { JWS_ALGORITHMS } from "./algorithms.js";
import { encodeBase64Url } from "./base64url.js";
import { checkSigner, type Signer } from "./signer.js";

const encoder = new TextEncoder();

/** Checks that a header can go with the signer: no other algorithm or key id, and no private key. */
function checkHeader(header: unknown, signer: Signer): asserts header is Readonly<Record<string, unknown>> {
  checkRecord(header, "The header must be an object");
  if (header.alg !== undefined && header.alg !== signer.algorithm) {
    throw new DataError(
      `The header names the algorithm ${describe(header.alg)}, and the signer signs with ${signer.algorithm}.`,
    );
  }
  if (header.kid !== undefined && signer.keyId !== undefined && header.kid !== signer.keyId) {
    throw new DataError(
      `The header names the key ${describe(header.kid)}, and the signer's key is ${describe(signer.keyId)}.`,
    );
  }
  if (isRecord(header.jwk) && "d" in header.jwk) {
    throw new DataError("The header jwk holds a private key (d), which would publish it: use the public key.");
  }
}

/** Checks the signature against the length that the algorithm fixes. */
function checkSignature(signature: unknown, algorithm: string): asserts signature is Uint8Array {
  if (!(signature instanceof Uint8Array)) {
    throw new DataError(`The signer must return the signature as a Uint8Array, found ${describe(signature)}.`);
  }
  const expected = JWS_ALGORITHMS.get(algorithm)?.signatureBytes;
  if (expected !== undefined && signature.byteLength !== expected) {
    throw new DataError(
      `The signature of ${algorithm} must have ${expected} bytes, the fixed-length R and S of JWS (RFC 7518 section 3.4), and it has ${signature.byteLength}: a KMS may return DER, which the host converts first.`,
    );
  }
}

/**
 * Assembles a compact JWS (RFC 7515 section 7.1) around a signer.
 *
 * @remarks
 * The protected header is the `header` with the `alg` of the signer, and the `kid` of the signer when the header has none. The
 * signer is called once, with the ASCII bytes of the signing input, and its signature is checked before it is used: an ECDSA
 * signature of the wrong length, such as DER, is refused here and never reaches a verifier. The payload is signed as it
 * is, base64url encoded (no unencoded payload, RFC 7797).
 *
 * @param header - The protected header, such as `{ typ: "JWT" }`. It may name the algorithm and the key of the signer, and no
 * other; a `jwk` in it must not hold a private key.
 * @param payload - The bytes to sign, such as the UTF-8 JSON of the claims.
 * @param signer - Signs the bytes.
 * @param options - The `signal` that ends the caller's wait, which the signer also receives.
 * @returns The compact JWS: the encoded header, the encoded payload and the encoded signature, joined by dots.
 * @throws `DataError` when an argument is not valid, the header names another algorithm or key than the signer, or the
 * signature has the wrong form.
 * @throws The `reason` of the signal when it aborts, before or during the call.
 */
export async function signCompactJws(
  header: Readonly<Record<string, unknown>>,
  payload: Uint8Array,
  signer: Signer,
  options?: CallOptions,
): Promise<string> {
  checkSigner(signer, "The signer");
  checkHeader(header, signer);
  if (options?.signal !== undefined) checkAbortSignal(options.signal, "The option signal");
  if (!(payload instanceof Uint8Array)) {
    throw new DataError(`The payload must be a Uint8Array, found ${describe(payload)}.`);
  }
  // A member that is `undefined`, as plain JavaScript may pass one, names nothing: spread over the signer's `alg` or `kid`, it
  // would drop them from the header that JSON writes.
  const given = Object.fromEntries(Object.entries(header).filter(([, value]) => value !== undefined));
  let protectedHeader: string;
  try {
    protectedHeader = JSON.stringify({
      alg: signer.algorithm,
      ...(signer.keyId === undefined ? {} : { kid: signer.keyId }),
      ...given,
    });
  } catch {
    throw new DataError("The header must be plain data that JSON can hold.");
  }
  options?.signal?.throwIfAborted();
  const signingInput = `${encodeBase64Url(encoder.encode(protectedHeader))}.${encodeBase64Url(payload)}`;
  const signature = await untilAborted(signer.sign(encoder.encode(signingInput), options), options?.signal);
  checkSignature(signature, signer.algorithm);
  return `${signingInput}.${encodeBase64Url(signature)}`;
}
