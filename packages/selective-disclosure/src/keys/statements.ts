import { p256 } from "@noble/curves/nist.js";
import { ES256 } from "./algorithm.js";

const encoder = new TextEncoder();

/**
 * Signs the UTF-8 bytes of a statement with ES256: ECDSA over P-256 and SHA-256, as 64 bytes of R and S.
 *
 * @remarks
 * The nonce follows RFC 6979, so a signature depends on the key and the statement alone and a weak random source cannot leak
 * the key. A signature of the half-order, which noble makes by default, is not asked for: the Recommendation does not ask
 * for it and its test vectors do not have it.
 */
export function signStatement(secretKey: Uint8Array, statement: string): Uint8Array {
  return p256.sign(encoder.encode(statement), secretKey, { lowS: false });
}

/**
 * Tells whether there is one signature for each statement and each is valid under the key.
 *
 * @remarks
 * The signatures are checked at once, which Web Crypto spreads over its threads.
 */
export async function verifyStatements(
  key: CryptoKey,
  statements: readonly string[],
  signatures: readonly Uint8Array[],
): Promise<boolean> {
  if (signatures.length !== statements.length) return false;
  const verdicts = await Promise.all(
    signatures.map((signature, index) =>
      // A copy of the signature: Web Crypto takes bytes over an ArrayBuffer, and these may lie over another kind of buffer.
      crypto.subtle.verify(ES256, key, new Uint8Array(signature), encoder.encode(statements[index])),
    ),
  );
  return verdicts.every(Boolean);
}
