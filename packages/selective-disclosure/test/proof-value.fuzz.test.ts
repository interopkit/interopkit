import { DataError } from "@interopkit/core";
import { base64urlnopad } from "@scure/base";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  isBaseProof,
  parseBaseProofValue,
  parseDerivedProofValue,
  serializeBaseProofValue,
  serializeDerivedProofValue,
} from "../src/proof-value/index.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_261_101, numRuns: 500 };

/** Values of every kind that JSON or JavaScript can hand over, including those that JSON cannot write. */
const anything = fc.oneof(
  fc.jsonValue(),
  fc.anything({
    withNullPrototype: true,
    withBigInt: true,
    withDate: true,
    withMap: true,
    withSet: true,
    withTypedArray: true,
  }),
);

const key = Uint8Array.of(0x80, 0x24, 0x03, ...new Uint8Array(32).fill(9));
const base = serializeBaseProofValue({
  baseSignature: new Uint8Array(64).fill(1),
  publicKey: key,
  hmacKey: new Uint8Array(32).fill(2),
  signatures: [new Uint8Array(64).fill(3), new Uint8Array(64).fill(4)],
  mandatoryPointers: ["/issuer"],
});
const derived = serializeDerivedProofValue({
  baseSignature: new Uint8Array(64).fill(1),
  publicKey: key,
  signatures: [new Uint8Array(64).fill(3)],
  labelMap: new Map([["c14n0", `u${base64urlnopad.encode(new Uint8Array(32).fill(5))}`]]),
  mandatoryIndexes: [0, 1],
});

/** Tells whether a function returns, or throws the error of the family, and nothing else. */
function returnsOrRefuses(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
  }
}

/** A proof value with its bytes changed, cut or extended: the header stays, so that the CBOR is what is read. */
function damaged(value: string, header: number) {
  const bytes = base64urlnopad.decode(value.slice(1));
  return fc
    .tuple(fc.nat(bytes.length - 1), fc.integer({ min: 0, max: 255 }), fc.nat(bytes.length))
    .map(([at, byte, cut]) => {
      const copy = bytes.slice(0, Math.max(cut, header)).slice();
      if (at >= header && at < copy.length) copy[at] = byte;
      return `u${base64urlnopad.encode(copy)}`;
    });
}

describe("the parsers of proof values on any input", () => {
  it("read a value or refuse it with a DataError, for a value of any kind", () => {
    fc.assert(
      fc.property(anything, (value) => {
        returnsOrRefuses(() => parseBaseProofValue(value));
        returnsOrRefuses(() => parseDerivedProofValue(value));
        expect(typeof isBaseProof(value)).toBe("boolean");
      }),
      RUNS,
    );
  });

  it("read a text with the header of a proof and any bytes after it, or refuse it with a DataError", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 400 }), (payload) => {
        const text = base64urlnopad.encode(payload);
        returnsOrRefuses(() => parseBaseProofValue(`u2V0A${text}`));
        returnsOrRefuses(() => parseDerivedProofValue(`u2V0B${text}`));
      }),
      RUNS,
    );
  });

  it("read a proof value that has its bytes changed or cut, or refuse it with a DataError", () => {
    fc.assert(
      fc.property(damaged(base, 3), damaged(derived, 3), (changedBase, changedDerived) => {
        returnsOrRefuses(() => parseBaseProofValue(changedBase));
        returnsOrRefuses(() => parseDerivedProofValue(changedDerived));
      }),
      RUNS,
    );
  });

  it("read back what they write, for any signatures, pointers, positions and labels", () => {
    const bytes = (length: number) => fc.uint8Array({ minLength: length, maxLength: length });
    fc.assert(
      fc.property(
        bytes(64),
        fc.array(bytes(64), { maxLength: 8 }),
        fc.array(fc.string(), { maxLength: 4 }),
        fc.array(fc.nat(1000), { maxLength: 8 }),
        fc.array(fc.tuple(fc.nat(500), bytes(32)), { maxLength: 6 }),
        (signature, signatures, mandatoryPointers, mandatoryIndexes, labels) => {
          const publicKey = Uint8Array.of(0x80, 0x24, 0x02, ...signature.subarray(0, 32));
          const labelMap = new Map(
            labels.map(([number, digest]) => [`c14n${number}`, `u${base64urlnopad.encode(digest)}`]),
          );
          const baseValue = {
            baseSignature: signature,
            publicKey,
            hmacKey: signature.subarray(0, 32),
            signatures,
            mandatoryPointers,
          };
          expect(parseBaseProofValue(serializeBaseProofValue(baseValue))).toStrictEqual({
            ...baseValue,
            hmacKey: new Uint8Array(signature.subarray(0, 32)),
          });
          const derivedValue = { baseSignature: signature, publicKey, signatures, labelMap, mandatoryIndexes };
          expect(parseDerivedProofValue(serializeDerivedProofValue(derivedValue))).toStrictEqual(derivedValue);
        },
      ),
      RUNS,
    );
  });
});
