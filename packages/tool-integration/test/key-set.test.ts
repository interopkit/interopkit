import { createCryptoKeySigner, DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import type { KeySet } from "../src/index.js";
import { checkKeySet } from "../src/protocol/internal.js";

/** The key pairs of the six approved algorithms: the RSA key of 2,048 bits for the RS algorithms, the curves for the ES ones. */
const ALGORITHMS = [
  [
    "RS256",
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  ],
  [
    "RS384",
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-384" },
  ],
  [
    "RS512",
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-512" },
  ],
  ["ES256", { name: "ECDSA", namedCurve: "P-256" }],
  ["ES384", { name: "ECDSA", namedCurve: "P-384" }],
  ["ES512", { name: "ECDSA", namedCurve: "P-521" }],
] as const;

/** Makes a key set with a signer of the algorithm and its public key as `kid` says. */
async function keySetOf(algorithm: (typeof ALGORITHMS)[number], kid = "key-1"): Promise<KeySet> {
  const [name, parameters] = algorithm;
  const pair = (await crypto.subtle.generateKey(parameters, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid };
  return { signer: createCryptoKeySigner(pair.privateKey, { algorithm: name, keyId: kid }), publicKeys: [publicKey] };
}

const keys = await Promise.all(ALGORITHMS.map((algorithm) => keySetOf(algorithm)));
const [rs256, , , es256] = keys as [KeySet, KeySet, KeySet, KeySet];

describe("checkKeySet", () => {
  it.each(ALGORITHMS.map(([name], index) => [name, keys[index]] as const))(
    "accepts a signer of %s with the public key it signs with",
    (_name, set) => {
      expect(() => checkKeySet(set)).not.toThrow();
    },
  );

  it("accepts a key set that keeps the earlier key beside the current one, for the overlap of a rotation", async () => {
    const earlier = await keySetOf(ALGORITHMS[0], "key-0");
    const current = rs256;
    expect(() =>
      checkKeySet({ signer: current.signer, publicKeys: [...earlier.publicKeys, ...current.publicKeys] }),
    ).not.toThrow();
  });

  it("refuses what is not a key set, a signer of an algorithm outside the six, and a signer that cannot sign", () => {
    const refusals: readonly (readonly [string, unknown])[] = [
      ["null", null],
      ["a string", "keys"],
      ["no signer", { publicKeys: rs256.publicKeys }],
      ["a signer that is a string", { signer: "x", publicKeys: rs256.publicKeys }],
      [
        "an algorithm outside the six",
        { signer: { ...rs256.signer, algorithm: "PS256" }, publicKeys: rs256.publicKeys },
      ],
      [
        "HS256",
        {
          signer: { algorithm: "HS256", keyId: "key-1", sign: async () => new Uint8Array() },
          publicKeys: rs256.publicKeys,
        },
      ],
      [
        "a signer with no sign function",
        { signer: { algorithm: "RS256", keyId: "key-1" }, publicKeys: rs256.publicKeys },
      ],
      ["no public keys", { signer: rs256.signer, publicKeys: [] }],
      ["public keys that are not a list", { signer: rs256.signer, publicKeys: {} }],
    ];
    for (const [name, value] of refusals) expect(() => checkKeySet(value), name).toThrow(DataError);
  });

  it("refuses public keys that break Security Framework section 6.3 or 7.2", async () => {
    const [key = {}] = rs256.publicKeys;
    const small = await crypto.subtle.exportKey(
      "jwk",
      (
        (await crypto.subtle.generateKey(
          {
            name: "RSASSA-PKCS1-v1_5",
            modulusLength: 1024,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
          },
          true,
          ["sign", "verify"],
        )) as CryptoKeyPair
      ).publicKey,
    );
    const set = (publicKeys: unknown) => ({ signer: rs256.signer, publicKeys });
    const refusals: readonly (readonly [string, unknown])[] = [
      ["a key that is not an object", set(["x"])],
      ["a key with no kid", set([{ ...key, kid: undefined }])],
      ["a kid used twice", set([key, key])],
      ["a key that holds the private exponent", set([{ ...key, d: "AQAB" }])],
      ["a key that holds a secret", set([{ ...key, k: "AQAB" }])],
      ["an RSA key of 1,024 bits", set([{ ...small, kid: "key-1" }])],
      ["an RSA key with no modulus", set([{ ...key, n: undefined }])],
      ["an RSA key with a modulus that is not base64url", set([{ ...key, n: "***" }])],
      ["an RSA key whose modulus is zero", set([{ ...key, n: "AAAA" }])],
      ["an EC key on a curve outside the three", set([{ kty: "EC", crv: "secp256k1", x: "A", y: "A", kid: "key-1" }])],
      ["a key of another type", set([{ kty: "OKP", crv: "Ed25519", x: "A", kid: "key-1" }])],
      [
        "a keyId that no key has",
        { signer: { algorithm: "RS256", keyId: "other", sign: rs256.signer.sign }, publicKeys: [key] },
      ],
      [
        "an EC key for an RSA algorithm",
        { signer: rs256.signer, publicKeys: [{ ...es256.publicKeys[0], kid: "key-1" }] },
      ],
      ["an RSA key for an EC algorithm", { signer: es256.signer, publicKeys: [{ ...key, kid: "key-1" }] }],
    ];
    for (const [name, value] of refusals) expect(() => checkKeySet(value), name).toThrow(DataError);
  });

  it("refuses an elliptic curve key on another curve than the algorithm names", async () => {
    const p384 = await keySetOf(ALGORITHMS[4]);
    expect(() => checkKeySet({ signer: es256.signer, publicKeys: [{ ...p384.publicKeys[0], kid: "key-1" }] })).toThrow(
      DataError,
    );
  });
});
