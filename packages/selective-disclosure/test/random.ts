import { vi } from "vitest";

/**
 * Makes `crypto.getRandomValues` fill any `Uint8Array` of the length of `bytes` with `bytes`, and every other request as it
 * always does. The libraries draw some random bytes of their own (the curve library blinds its computations), which this
 * leaves alone.
 *
 * @returns Puts `crypto.getRandomValues` back.
 */
export function fixRandomBytes(bytes: Uint8Array): () => void {
  const original = crypto.getRandomValues;
  const spy = vi
    .spyOn(crypto, "getRandomValues")
    .mockImplementation(<T extends Exclude<BufferSource, ArrayBuffer>>(array: T): T => {
      if (array instanceof Uint8Array && array.length === bytes.length) {
        array.set(bytes);
        return array;
      }
      // `call` loses the type parameter, and the result is the array that was passed.
      return original.call(crypto, array) as T;
    });
  return () => spy.mockRestore();
}
