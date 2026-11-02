import { ES256 } from "./algorithm.js";

const encoder = new TextEncoder();

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
