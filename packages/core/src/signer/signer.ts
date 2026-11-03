import type { CallOptions } from "../call-options.js";
import { checkAbortSignal, checkFunction, checkNonEmptyString, checkRecord, describe, isRecord } from "../checks.js";
import { DataError } from "../errors.js";
import { raceAbort } from "../race-abort.js";
import { JWS_ALGORITHMS, type KeySpec } from "./algorithms.js";

/** Signs bytes with a key that the host holds: a `CryptoKey`, a KMS or an HSM. */
export interface Signer {
  /** A JOSE algorithm name, such as `RS256`, `ES256` or `EdDSA`. */
  readonly algorithm: string;
  /**
   * The verification method or `kid` that the signature names.
   *
   * @defaultValue none
   */
  readonly keyId?: string;
  /**
   * Signs the bytes.
   *
   * @remarks
   * The signature is in its JOSE form: for ES256, ES384 and ES512 the fixed-length R and S (64, 96 and 132 bytes), never the
   * DER that many cloud KMS services return, which the host converts first. `signCompactJws` refuses a signature of
   * another length.
   *
   * @param data - What to sign.
   * @param options - The `signal` that ends the caller's wait.
   * @returns The signature.
   */
  sign(data: Uint8Array, options?: CallOptions): Promise<Uint8Array>;
}

/** What `createCryptoKeySigner` needs beyond the key. */
export interface CryptoKeySignerOptions {
  /** The JOSE algorithm that the key signs with: `RS256`, `RS384`, `RS512`, `PS256`, `PS384`, `PS512`, `ES256`, `ES384`, `ES512` or `EdDSA`. */
  readonly algorithm: string;
  /**
   * The `keyId` of the signer.
   *
   * @defaultValue none
   */
  readonly keyId?: string;
}

/** The algorithms that a `CryptoKey` can sign, in the words of an error message. */
const CRYPTO_KEY_ALGORITHMS = [...JWS_ALGORITHMS].flatMap(([name, { key }]) => (key === undefined ? [] : [name]));

/** Checks that a key is a private key of the kind that the algorithm needs. A private key of Web Crypto always may sign. */
function checkKey(key: unknown, algorithm: string, spec: KeySpec): asserts key is CryptoKey {
  checkRecord(key, "The key must be a CryptoKey");
  if (key.type !== "private") {
    throw new DataError(
      `The key must be a private key, found a ${describe(key.type)} key: a signer holds a private key.`,
    );
  }
  const kind = key.algorithm;
  if (!isRecord(kind) || kind.name !== spec.name) {
    throw new DataError(`The key is not a ${spec.name} key, which ${algorithm} needs.`);
  }
  if (spec.hash !== undefined && (!isRecord(kind.hash) || kind.hash.name !== spec.hash)) {
    throw new DataError(`The key was not made for the hash ${spec.hash}, which ${algorithm} needs.`);
  }
  if (spec.curve !== undefined && kind.namedCurve !== spec.curve) {
    throw new DataError(`The key is not on the curve ${spec.curve}, which ${algorithm} needs.`);
  }
}

/**
 * Makes a signer from a `CryptoKey`.
 *
 * @remarks
 * The key is checked against the algorithm: a private key of the kind (and for RSA the hash, for ECDSA the curve) that the
 * algorithm names. A signature that Web Crypto makes for ECDSA is already the fixed-length R and S that JOSE
 * needs. `sign` ends the caller's wait when its `signal` aborts; the signature that Web Crypto goes on to make is dropped.
 *
 * @param key - A private `CryptoKey`.
 * @param options - The algorithm and, optionally, the key id.
 * @returns The signer.
 * @throws `DataError` when the algorithm is not one that a `CryptoKey` signs, or the key does not fit it.
 */
export function createCryptoKeySigner(key: CryptoKey, options: CryptoKeySignerOptions): Signer {
  checkRecord(options, "The options of createCryptoKeySigner must be an object");
  const { algorithm, keyId } = options;
  const spec = typeof algorithm === "string" ? JWS_ALGORITHMS.get(algorithm)?.key : undefined;
  if (spec === undefined) {
    throw new DataError(
      `The option algorithm must be one of ${CRYPTO_KEY_ALGORITHMS.join(", ")}, found ${describe(algorithm)}.`,
    );
  }
  if (keyId !== undefined) checkNonEmptyString(keyId, "The option keyId");
  checkKey(key, algorithm, spec);
  return {
    algorithm,
    ...(keyId === undefined ? {} : { keyId }),
    async sign(data, callOptions) {
      if (callOptions?.signal !== undefined) checkAbortSignal(callOptions.signal, "The option signal");
      callOptions?.signal?.throwIfAborted();
      // A copy: Web Crypto takes bytes over an ArrayBuffer, and a caller's bytes may lie over another kind of buffer.
      const signature = await raceAbort(
        crypto.subtle.sign(spec.params, key, new Uint8Array(data)),
        callOptions?.signal,
      );
      return new Uint8Array(signature);
    },
  };
}

/**
 * Checks a signer, as a host passes it from JavaScript.
 *
 * @param label - Names the value in the error message, such as `The signer`.
 * @throws `DataError` when it has no JOSE algorithm of a private key, no `sign` function, or a `keyId` that is not a non-empty string.
 */
export function checkSigner(value: unknown, label: string): asserts value is Signer {
  checkRecord(value, `${label} must be an object`);
  if (typeof value.algorithm !== "string" || !JWS_ALGORITHMS.has(value.algorithm)) {
    throw new DataError(
      `${label} must name one of the algorithms ${[...JWS_ALGORITHMS.keys()].join(", ")}, found ${describe(value.algorithm)}.`,
    );
  }
  checkFunction(value.sign, `The function sign of ${label.toLowerCase()} must be a function`);
  if (value.keyId !== undefined) checkNonEmptyString(value.keyId, `The keyId of ${label.toLowerCase()}`);
}
