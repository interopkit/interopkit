import { DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import { decode } from "cborg";

/**
 * How the payload of a proof value is read. Indefinite lengths, `undefined`, NaN, infinities and integers beyond 2^53 have no
 * place in it, a map with a key twice is refused, and a map is a `Map` so that its keys stay integers. Tag 64 is the one tag
 * that is read, as a byte string: some implementations write the byte strings of a proof value with it, and the
 * Recommendation says that none must (section 3.5.2).
 */
const DECODE_OPTIONS = {
  useMaps: true,
  allowIndefinite: false,
  allowUndefined: false,
  allowInfinity: false,
  allowNaN: false,
  allowBigInt: false,
  rejectDuplicateMapKeys: true,
  tags: { 64: (read: () => unknown) => read() },
};

/**
 * Reads the CBOR array of the components of a proof value.
 *
 * @param payload - The bytes after the header.
 * @param count - How many components the proof has.
 * @param kind - Names the kind of proof in the error message, such as `base`.
 * @throws `DataError` when the bytes are not CBOR, or are not an array of exactly `count` items.
 */
export function readComponents(payload: Uint8Array, count: number, kind: string): readonly unknown[] {
  let components: unknown;
  try {
    components = decode(payload, DECODE_OPTIONS);
  } catch (cause) {
    throw new DataError(`The proofValue of a ${kind} proof does not hold valid CBOR.`, { cause });
  }
  if (!Array.isArray(components) || components.length !== count) {
    throw new DataError(
      `The proofValue of a ${kind} proof must hold an array of ${count} items, found ${describe(components)}.`,
    );
  }
  return components;
}
