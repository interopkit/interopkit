import { DataError } from "@interopkit/core";
import { base64urlnopad } from "@scure/base";
import { encode, Tagged } from "cborg";
import { describe, expect, it } from "vitest";
import {
  type BaseProofValue,
  type DerivedProofValue,
  isBaseProof,
  parseBaseProofValue,
  parseDerivedProofValue,
  serializeBaseProofValue,
  serializeDerivedProofValue,
  signData,
} from "../src/proof-value/index.js";
import { BASE_HEADER, DERIVED_HEADER, encodeProofValue } from "../src/proof-value/internal.js";

/** `length` bytes that all hold `fill`. */
const bytes = (length: number, fill: number) => new Uint8Array(length).fill(fill);

/** The multikey form of a P-256 public key: the header of `p256-pub` and a compressed point. */
const publicKey = () => Uint8Array.of(0x80, 0x24, 0x02, ...bytes(32, 7));

const base = (): BaseProofValue => ({
  baseSignature: bytes(64, 1),
  publicKey: publicKey(),
  hmacKey: bytes(32, 3),
  signatures: [bytes(64, 4), bytes(64, 5)],
  mandatoryPointers: ["/issuer", "/validFrom"],
});

const derived = (): DerivedProofValue => ({
  baseSignature: bytes(64, 1),
  publicKey: publicKey(),
  signatures: [bytes(64, 4)],
  labelMap: new Map([
    ["c14n0", `u${base64urlnopad.encode(bytes(32, 8))}`],
    ["c14n11", `u${base64urlnopad.encode(bytes(32, 9))}`],
  ]),
  mandatoryIndexes: [0, 2, 3],
});

/** The proof value of a base proof with the given CBOR components. */
const baseValueOf = (...components: unknown[]) => encodeProofValue(BASE_HEADER, encode(components));
const derivedValueOf = (...components: unknown[]) => encodeProofValue(DERIVED_HEADER, encode(components));

describe("the proof value of a base proof", () => {
  it("starts with the multibase text of the header 0xd9 0x5d 0x00", () => {
    expect(serializeBaseProofValue(base()).startsWith("u2V0A")).toBe(true);
  });

  it("is read back as it was written", () => {
    expect(parseBaseProofValue(serializeBaseProofValue(base()))).toStrictEqual(base());
  });

  it("holds the five components as an array of CBOR items with no tag", () => {
    const payload = base64urlnopad.decode(serializeBaseProofValue(base()).slice(1)).subarray(BASE_HEADER.length);
    // 0x85 is an array of five; 0x58 0x40 is a byte string of 64 bytes.
    expect(Array.from(payload.subarray(0, 4))).toStrictEqual([0x85, 0x58, 0x40, 1]);
  });

  it("is refused when it is not a string", () => {
    expect(() => parseBaseProofValue(undefined)).toThrow("must be a string, found undefined");
    expect(() => parseBaseProofValue(["u2V0A"])).toThrow(DataError);
  });

  it("is refused when it does not start with the header of a base proof", () => {
    expect(() => parseBaseProofValue(serializeDerivedProofValue(derived()))).toThrow("must start with u2V0A");
    expect(() => parseBaseProofValue("z2V0A")).toThrow("must start with u2V0A");
    expect(() => parseBaseProofValue("")).toThrow("must start with u2V0A");
  });

  it("is refused when the text after the header is not base64url without padding", () => {
    expect(() => parseBaseProofValue("u2V0A!!")).toThrow("not base64url text without padding");
    expect(() => parseBaseProofValue(`${serializeBaseProofValue(base())}=`)).toThrow("not base64url text");
  });

  it("is refused when the payload is not CBOR, or is not an array of five items", () => {
    expect(() => parseBaseProofValue("u2V0AAAAA")).toThrow("does not hold valid CBOR");
    expect(() => parseBaseProofValue(baseValueOf(1, 2, 3, 4))).toThrow("must hold an array of 5 items");
    expect(() => parseBaseProofValue(encodeProofValue(BASE_HEADER, encode({})))).toThrow(
      "must hold an array of 5 items",
    );
  });

  it("is refused when a component has the wrong kind or length", () => {
    const { baseSignature, publicKey: key, hmacKey, signatures, mandatoryPointers } = base();
    expect(() => parseBaseProofValue(baseValueOf(bytes(63, 1), key, hmacKey, signatures, mandatoryPointers))).toThrow(
      "The baseSignature must be a byte string of 64 bytes, found a byte string of 63 bytes",
    );
    expect(() => parseBaseProofValue(baseValueOf("text", key, hmacKey, signatures, mandatoryPointers))).toThrow(
      'found "text"',
    );
    expect(() =>
      parseBaseProofValue(baseValueOf(baseSignature, bytes(35, 0), hmacKey, signatures, mandatoryPointers)),
    ).toThrow("must start with the multikey header of a P-256 key");
    expect(() =>
      parseBaseProofValue(baseValueOf(baseSignature, bytes(36, 0), hmacKey, signatures, mandatoryPointers)),
    ).toThrow("The publicKey must be a byte string of 35 bytes");
    expect(() =>
      parseBaseProofValue(baseValueOf(baseSignature, key, bytes(31, 3), signatures, mandatoryPointers)),
    ).toThrow("The hmacKey must be a byte string of 32 bytes");
    expect(() => parseBaseProofValue(baseValueOf(baseSignature, key, hmacKey, "none", mandatoryPointers))).toThrow(
      "The signatures must be an array",
    );
    expect(() =>
      parseBaseProofValue(baseValueOf(baseSignature, key, hmacKey, [bytes(64, 1), bytes(2, 1)], mandatoryPointers)),
    ).toThrow("The signature 1 must be a byte string of 64 bytes");
    expect(() => parseBaseProofValue(baseValueOf(baseSignature, key, hmacKey, signatures, ["/a", 1]))).toThrow(
      "The mandatoryPointers must be an array of strings",
    );
    expect(() => parseBaseProofValue(baseValueOf(baseSignature, key, hmacKey, signatures, "/a"))).toThrow(
      "The mandatoryPointers must be an array of strings",
    );
  });

  it("is refused when the CBOR is indefinite, has undefined or NaN, has a number beyond 2^53, or has an unknown tag", () => {
    const { baseSignature, publicKey: key, hmacKey, signatures } = base();
    const indefinite = Uint8Array.of(0x9f, 0xff);
    for (const payload of [indefinite, encode([undefined]), encode([Number.NaN]), encode([2n ** 60n])]) {
      expect(() => parseBaseProofValue(encodeProofValue(BASE_HEADER, payload))).toThrow(DataError);
    }
    const tagged = encode([baseSignature, key, hmacKey, signatures, [new Tagged(1234, "x")]]);
    expect(() => parseBaseProofValue(encodeProofValue(BASE_HEADER, tagged))).toThrow("does not hold valid CBOR");
  });

  it("reads a byte string that tag 64 wraps, as some implementations write it", () => {
    const { baseSignature, publicKey: key, hmacKey, signatures, mandatoryPointers } = base();
    const tagged = encode([new Tagged(64, baseSignature), key, hmacKey, signatures, mandatoryPointers]);
    expect(parseBaseProofValue(encodeProofValue(BASE_HEADER, tagged)).baseSignature).toStrictEqual(baseSignature);
  });

  it("is refused when bytes follow the array", () => {
    const payload = base64urlnopad.decode(serializeBaseProofValue(base()).slice(1)).subarray(BASE_HEADER.length);
    expect(() => parseBaseProofValue(encodeProofValue(BASE_HEADER, Uint8Array.of(...payload, 0)))).toThrow(
      "does not hold valid CBOR",
    );
  });
});

describe("the proof value of a derived proof", () => {
  it("starts with the multibase text of the header 0xd9 0x5d 0x01", () => {
    expect(serializeDerivedProofValue(derived()).startsWith("u2V0B")).toBe(true);
  });

  it("is read back as it was written, with the label map restored", () => {
    expect(parseDerivedProofValue(serializeDerivedProofValue(derived()))).toStrictEqual(derived());
  });

  it("writes the label map as a CBOR map from numbers to the digests behind the labels", () => {
    const payload = base64urlnopad
      .decode(serializeDerivedProofValue(derived()).slice(1))
      .subarray(DERIVED_HEADER.length);
    // The label map is the fourth item: after the signature (3 + 64 bytes), the key (2 + 35), and the signatures (1 + 2 + 64).
    const at = 1 + 66 + 37 + 1 + 66;
    expect(payload[at]).toBe(0xa2);
    expect(payload[at + 1]).toBe(0);
  });

  it("is refused when it starts with the header of a base proof", () => {
    expect(() => parseDerivedProofValue(serializeBaseProofValue(base()))).toThrow("must start with u2V0B");
  });

  it("is refused when a component has the wrong kind or length", () => {
    const { baseSignature, publicKey: key, signatures } = derived();
    const map = new Map([[0, bytes(32, 1)]]);
    expect(() => parseDerivedProofValue(derivedValueOf(baseSignature, key, [bytes(10, 1)], map, [0]))).toThrow(
      "The signature 0 must be a byte string of 64 bytes",
    );
    expect(() => parseDerivedProofValue(derivedValueOf(baseSignature, key, signatures, "map", [0]))).toThrow(
      "The label map must be a CBOR map",
    );
    expect(() =>
      parseDerivedProofValue(derivedValueOf(baseSignature, key, signatures, new Map([["c14n0", bytes(32, 1)]]), [0])),
    ).toThrow("non-negative integers as keys");
    expect(() =>
      parseDerivedProofValue(derivedValueOf(baseSignature, key, signatures, new Map([[-1, bytes(32, 1)]]), [0])),
    ).toThrow("non-negative integers as keys");
    expect(() =>
      parseDerivedProofValue(derivedValueOf(baseSignature, key, signatures, new Map([[0, bytes(31, 1)]]), [0])),
    ).toThrow("byte strings of 32 bytes as values");
    expect(() => parseDerivedProofValue(derivedValueOf(baseSignature, key, signatures, map, [0, -1]))).toThrow(
      "The mandatoryIndexes must be an array of non-negative integers",
    );
    expect(() => parseDerivedProofValue(derivedValueOf(baseSignature, key, signatures, map, [1.5]))).toThrow(DataError);
    expect(() => parseDerivedProofValue(derivedValueOf(baseSignature, key, signatures, map, "0"))).toThrow(DataError);
  });

  it("is refused when the label map names a key twice", () => {
    const { baseSignature, publicKey: key, signatures } = derived();
    // A CBOR map of two entries with the key 0 twice.
    const duplicate = Uint8Array.of(0xa2, 0x00, 0x58, 0x20, ...bytes(32, 1), 0x00, 0x58, 0x20, ...bytes(32, 2));
    const head = encode([baseSignature, key, signatures]);
    const payload = Uint8Array.of(0x85, ...head.subarray(1), ...duplicate, 0x80);
    expect(() => parseDerivedProofValue(encodeProofValue(DERIVED_HEADER, payload))).toThrow("does not hold valid CBOR");
  });
});

describe("a base proof, as a verifier tells it", () => {
  it("is a proof of the suite whose value starts with the header of a base proof", () => {
    expect(isBaseProof({ cryptosuite: "ecdsa-sd-2023", proofValue: serializeBaseProofValue(base()) })).toBe(true);
  });

  it("is not a derived proof, a proof of another suite, or anything that is not a proof", () => {
    expect(isBaseProof({ cryptosuite: "ecdsa-sd-2023", proofValue: serializeDerivedProofValue(derived()) })).toBe(
      false,
    );
    expect(isBaseProof({ cryptosuite: "ecdsa-rdfc-2019", proofValue: serializeBaseProofValue(base()) })).toBe(false);
    expect(isBaseProof({ cryptosuite: "ecdsa-sd-2023", proofValue: 5 })).toBe(false);
    expect(isBaseProof({ cryptosuite: "ecdsa-sd-2023" })).toBe(false);
    for (const value of [null, undefined, "u2V0A", 7, [], [{ cryptosuite: "ecdsa-sd-2023" }]]) {
      expect(isBaseProof(value)).toBe(false);
    }
  });
});

describe("the data that the issuer's key signs", () => {
  it("joins the hash of the proof options, the public key of the proof and the hash of the mandatory statements, in order", () => {
    expect(Array.from(signData(Uint8Array.of(1, 2), Uint8Array.of(3), Uint8Array.of(4, 5, 6)))).toStrictEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});
