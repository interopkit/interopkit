import fc from "fast-check";
import { compactVerify, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import { DataError, type Signer, signCompactJws, signerFromCryptoKey } from "../src/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PAYLOAD = encoder.encode('{"sub":"user-1"}');
const FUZZ = { seed: 20_261_101, numRuns: 40 } as const;

/** What `crypto.subtle.generateKey` takes for each algorithm, and the bytes of a signature when they are fixed. */
const ALGORITHMS = [
  [
    "RS256",
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
  ],
  [
    "RS384",
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-384" },
  ],
  [
    "RS512",
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-512" },
  ],
  ["PS256", { name: "RSA-PSS", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" }],
  ["PS384", { name: "RSA-PSS", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-384" }],
  ["PS512", { name: "RSA-PSS", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-512" }],
  ["ES256", { name: "ECDSA", namedCurve: "P-256" }],
  ["ES384", { name: "ECDSA", namedCurve: "P-384" }],
  ["ES512", { name: "ECDSA", namedCurve: "P-521" }],
  ["EdDSA", { name: "Ed25519" }],
] as const;

/** The bytes of the R and S of a signature of each ECDSA algorithm: twice the size of the curve's order. */
const SIGNATURE_BYTES = { ES256: 64, ES384: 96, ES512: 132 } as const;

/** Generates a key pair that can sign and verify. */
async function generate(algorithm: (typeof ALGORITHMS)[number][1]): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(algorithm, false, ["sign", "verify"])) as CryptoKeyPair;
}

/** Splits a compact JWS into its three parts, decoded. */
function parts(jws: string): { readonly header: Record<string, unknown>; readonly signature: Uint8Array } {
  const [header = "", , signature = ""] = jws.split(".");
  return {
    header: JSON.parse(decoder.decode(Buffer.from(header, "base64url"))),
    signature: new Uint8Array(Buffer.from(signature, "base64url")),
  };
}

/** The DER form of an ECDSA signature, which a cloud KMS returns and JWS does not use (RFC 3279 section 2.2.3). */
function toDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  const integer = (bytes: Uint8Array): number[] => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    const body = [...bytes.subarray(start)];
    if ((body[0] ?? 0) >= 0x80) body.unshift(0);
    return [0x02, body.length, ...body];
  };
  const content = [...integer(raw.subarray(0, half)), ...integer(raw.subarray(half))];
  return Uint8Array.from([0x30, ...(content.length > 127 ? [0x81] : []), content.length, ...content]);
}

/** Runs a call and returns what it rejects with. */
async function failureOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("The call resolved.");
}

describe("a signer over a CryptoKey", () => {
  it.each(ALGORITHMS)("signs a compact JWS with %s that jose verifies", async (algorithm, parameters) => {
    const pair = await generate(parameters);
    const signer = signerFromCryptoKey(pair.privateKey, { algorithm, keyId: "key-1" });
    const jws = await signCompactJws({ typ: "JWT" }, PAYLOAD, signer);
    const verified = await compactVerify(jws, pair.publicKey);
    expect(decoder.decode(verified.payload)).toBe('{"sub":"user-1"}');
    expect(verified.protectedHeader).toStrictEqual({ alg: algorithm, kid: "key-1", typ: "JWT" });
    const { signature } = parts(jws);
    if (algorithm in SIGNATURE_BYTES)
      expect(signature).toHaveLength(SIGNATURE_BYTES[algorithm as keyof typeof SIGNATURE_BYTES]);
  });

  it("signs any payload, whatever bytes it holds", async () => {
    const pair = await generate({ name: "ECDSA", namedCurve: "P-256" });
    const signer = signerFromCryptoKey(pair.privateKey, { algorithm: "ES256" });
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 200 }), async (payload) => {
        const verified = await compactVerify(await signCompactJws({}, payload, signer), pair.publicKey);
        expect(verified.payload).toStrictEqual(payload);
      }),
      FUZZ,
    );
  });

  it("signs a payload of every byte value and one longer than a chunk of the encoder", async () => {
    const pair = await generate({ name: "Ed25519" });
    const signer = signerFromCryptoKey(pair.privateKey, { algorithm: "EdDSA" });
    for (const payload of [
      Uint8Array.from({ length: 256 }, (_unused, index) => index),
      new Uint8Array(100_000).fill(251),
    ]) {
      const verified = await compactVerify(await signCompactJws({}, payload, signer), pair.publicKey);
      expect(verified.payload).toStrictEqual(payload);
    }
  });

  it("states its algorithm and key id, and has no key id when it is given none", async () => {
    const pair = await generate({ name: "ECDSA", namedCurve: "P-256" });
    expect(signerFromCryptoKey(pair.privateKey, { algorithm: "ES256", keyId: "k" })).toMatchObject({
      algorithm: "ES256",
      keyId: "k",
    });
    expect(Object.hasOwn(signerFromCryptoKey(pair.privateKey, { algorithm: "ES256" }), "keyId")).toBe(false);
  });

  it("refuses a key that does not fit the algorithm, and says why", async () => {
    const p256 = await generate({ name: "ECDSA", namedCurve: "P-256" });
    const rsa256 = await generate(ALGORITHMS[0][1]);
    const pss256 = await generate(ALGORITHMS[3][1]);
    const cases: readonly [string, () => unknown][] = [
      [
        'The key must be a private key, found a "public" key: a signer holds a private key.',
        () => signerFromCryptoKey(p256.publicKey, { algorithm: "ES256" }),
      ],
      [
        "The key is not on the curve P-384, which ES384 needs.",
        () => signerFromCryptoKey(p256.privateKey, { algorithm: "ES384" }),
      ],
      [
        "The key is not a RSASSA-PKCS1-v1_5 key, which RS256 needs.",
        () => signerFromCryptoKey(p256.privateKey, { algorithm: "RS256" }),
      ],
      [
        "The key was not made for the hash SHA-384, which RS384 needs.",
        () => signerFromCryptoKey(rsa256.privateKey, { algorithm: "RS384" }),
      ],
      [
        "The key is not a RSA-PSS key, which PS256 needs.",
        () => signerFromCryptoKey(rsa256.privateKey, { algorithm: "PS256" }),
      ],
      [
        "The key is not a RSASSA-PKCS1-v1_5 key, which RS256 needs.",
        () => signerFromCryptoKey(pss256.privateKey, { algorithm: "RS256" }),
      ],
      [
        "The key is not a Ed25519 key, which EdDSA needs.",
        () => signerFromCryptoKey(p256.privateKey, { algorithm: "EdDSA" }),
      ],
    ];
    for (const [message, call] of cases) expect(call, message).toThrow(new DataError(message));
  });

  it("refuses an algorithm that a CryptoKey does not sign, options of other types and a key that is not a key", async () => {
    const pair = await generate({ name: "ECDSA", namedCurve: "P-256" });
    const message =
      "The option algorithm must be one of RS256, RS384, RS512, PS256, PS384, PS512, ES256, ES384, ES512, EdDSA, found";
    for (const algorithm of ["none", "HS256", "ES256K", "es256", "", JSON.parse("5"), JSON.parse("null")]) {
      expect(() => signerFromCryptoKey(pair.privateKey, { algorithm }), String(algorithm)).toThrow(message);
    }
    expect(() => signerFromCryptoKey(pair.privateKey, JSON.parse("null"))).toThrow(
      new DataError("The options of signerFromCryptoKey must be an object, found null."),
    );
    expect(() => signerFromCryptoKey(pair.privateKey, { algorithm: "ES256", keyId: "" })).toThrow(
      new DataError('The option keyId must be a non-empty string, found "".'),
    );
    expect(() => signerFromCryptoKey(JSON.parse("null"), { algorithm: "ES256" })).toThrow(
      new DataError("The key must be a CryptoKey, found null."),
    );
  });

  it("ends the wait when the signal aborts, and signs nothing when it is aborted before", async () => {
    const pair = await generate({ name: "ECDSA", namedCurve: "P-256" });
    const signer = signerFromCryptoKey(pair.privateKey, { algorithm: "ES256" });
    const reason = new Error("Left the page.");
    expect(await failureOf(signer.sign(PAYLOAD, { signal: AbortSignal.abort(reason) }))).toBe(reason);
    const controller = new AbortController();
    const pending = signer.sign(PAYLOAD, { signal: controller.signal });
    controller.abort(reason);
    expect(await failureOf(pending)).toBe(reason);
  });
});

describe("signCompactJws", () => {
  const signing = async (algorithm = "ES256") => {
    const parameters = ALGORITHMS.find(([name]) => name === algorithm)?.[1] ?? ALGORITHMS[6][1];
    const pair = await generate(parameters);
    return { pair, signer: signerFromCryptoKey(pair.privateKey, { algorithm, keyId: "key-1" }) };
  };
  /** A signer whose calls are counted. */
  const counting = (signer: Signer): { readonly signer: Signer; readonly calls: () => number } => {
    let calls = 0;
    return {
      signer: {
        algorithm: signer.algorithm,
        ...(signer.keyId === undefined ? {} : { keyId: signer.keyId }),
        sign: (data, options) => {
          calls += 1;
          return signer.sign(data, options);
        },
      },
      calls: () => calls,
    };
  };

  it("writes the payload and the signature as base64url without padding, as RFC 4648 does, for bytes of any length", async () => {
    const { signer } = await signing("EdDSA");
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 3000 }), async (payload) => {
        const [, written, signature] = (await signCompactJws({}, payload, signer)).split(".");
        expect(written).toBe(Buffer.from(payload).toString("base64url"));
        expect(Buffer.from(String(signature), "base64url").toString("base64url")).toBe(signature);
      }),
      { seed: 20_261_102, numRuns: 200 },
    );
  });

  it("puts the algorithm and the key id of the signer first in the header, and keeps the other fields of the header", async () => {
    const { signer } = await signing();
    const jws = await signCompactJws({ typ: "vc+jwt", cty: "vc" }, PAYLOAD, signer);
    expect(Object.entries(parts(jws).header)).toStrictEqual([
      ["alg", "ES256"],
      ["kid", "key-1"],
      ["typ", "vc+jwt"],
      ["cty", "vc"],
    ]);
    expect(decodeProtectedHeader(jws)).toStrictEqual({ alg: "ES256", kid: "key-1", typ: "vc+jwt", cty: "vc" });
  });

  it("accepts a header that names the algorithm and the key of the signer", async () => {
    const { signer } = await signing();
    const jws = await signCompactJws({ alg: "ES256", kid: "key-1" }, PAYLOAD, signer);
    expect(parts(jws).header).toStrictEqual({ alg: "ES256", kid: "key-1" });
  });

  it("refuses a header that names another algorithm or key, before the signer is called", async () => {
    const { signer } = await signing();
    const { signer: spy, calls } = counting(signer);
    const cases: readonly [string, Record<string, unknown>][] = [
      ['The header names the algorithm "RS256", and the signer signs with ES256.', { alg: "RS256" }],
      ['The header names the algorithm "none", and the signer signs with ES256.', { alg: "none" }],
      ['The header names the key "other", and the signer\'s key is "key-1".', { kid: "other" }],
    ];
    for (const [message, header] of cases) {
      expect(await failureOf(signCompactJws(header, PAYLOAD, spy)), message).toStrictEqual(new DataError(message));
    }
    expect(calls()).toBe(0);
  });

  it("keeps the algorithm and the key id of the signer for a header whose alg and kid are undefined", async () => {
    const { signer } = await signing();
    const jws = await signCompactJws({ alg: undefined, kid: undefined, typ: "JWT" }, PAYLOAD, signer);
    expect(Object.entries(parts(jws).header)).toStrictEqual([
      ["alg", "ES256"],
      ["kid", "key-1"],
      ["typ", "JWT"],
    ]);
  });

  it("lets a header name a key when the signer names none", async () => {
    const pair = await generate({ name: "ECDSA", namedCurve: "P-256" });
    const signer = signerFromCryptoKey(pair.privateKey, { algorithm: "ES256" });
    expect(parts(await signCompactJws({ kid: "did:example:1#key-1" }, PAYLOAD, signer)).header.kid).toBe(
      "did:example:1#key-1",
    );
  });

  it("refuses a header whose jwk holds a private key, and accepts one that holds a public key", async () => {
    const { pair, signer } = await signing();
    const { spy, calls } = { spy: counting(signer).signer, calls: () => 0 };
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    expect(await signCompactJws({ jwk }, PAYLOAD, spy)).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/u);
    const message = "The header jwk holds a private key (d), which would publish it: use the public key.";
    expect(await failureOf(signCompactJws({ jwk: { ...jwk, d: "AAAA" } }, PAYLOAD, signer))).toStrictEqual(
      new DataError(message),
    );
    expect(calls()).toBe(0);
  });

  it("refuses a signature of the wrong length for an ECDSA algorithm, such as DER, before it is used", async () => {
    for (const algorithm of ["ES256", "ES384", "ES512"] as const) {
      const { signer } = await signing(algorithm);
      const kms: Signer = { algorithm, sign: async (data) => toDer(await signer.sign(data)) };
      const error = await failureOf(signCompactJws({}, PAYLOAD, kms));
      expect(error).toBeInstanceOf(DataError);
      expect((error as DataError).message).toMatch(
        new RegExp(
          `^The signature of ${algorithm} must have ${SIGNATURE_BYTES[algorithm]} bytes, the fixed-length R and S of JWS \\(RFC 7518 section 3\\.4\\), and it has \\d+: a KMS may return DER, which the host converts first\\.$`,
          "u",
        ),
      );
    }
  });

  it("accepts a signature of the fixed length from a signer that is not a CryptoKey, and refuses another length for ES256K", async () => {
    const fixed = (algorithm: string, bytes: number): Signer => ({
      algorithm,
      sign: async () => new Uint8Array(bytes).fill(7),
    });
    expect(await signCompactJws({}, PAYLOAD, fixed("ES256K", 64))).toMatch(/\.[\w-]{86}$/u);
    expect(await failureOf(signCompactJws({}, PAYLOAD, fixed("ES256K", 71)))).toBeInstanceOf(DataError);
    expect(await signCompactJws({}, PAYLOAD, fixed("RS256", 256))).toMatch(/\.[\w-]{342}$/u);
    expect(await signCompactJws({}, PAYLOAD, fixed("EdDSA", 114))).toBeTypeOf("string");
  });

  it("refuses a signature that is not bytes", async () => {
    const kms = { algorithm: "RS256", sign: async () => new ArrayBuffer(256) } as unknown as Signer;
    expect(await failureOf(signCompactJws({}, PAYLOAD, kms))).toStrictEqual(
      new DataError("The signer must return the signature as a Uint8Array, found an object."),
    );
  });

  it("refuses a signer that is not one, and an algorithm that is not the signature of a private key", async () => {
    const algorithms = "RS256, RS384, RS512, PS256, PS384, PS512, ES256, ES384, ES512, ES256K, EdDSA";
    const sign = async () => new Uint8Array(1);
    const cases: readonly [string, unknown][] = [
      ["The signer must be an object, found null.", JSON.parse("null")],
      [`The signer must name one of the algorithms ${algorithms}, found "none".`, { algorithm: "none", sign }],
      [`The signer must name one of the algorithms ${algorithms}, found "HS256".`, { algorithm: "HS256", sign }],
      [`The signer must name one of the algorithms ${algorithms}, found undefined.`, { sign }],
      ["The function sign of the signer must be a function, found undefined.", { algorithm: "RS256" }],
      ['The keyId of the signer must be a non-empty string, found "".', { algorithm: "RS256", sign, keyId: "" }],
    ];
    for (const [message, signer] of cases) {
      expect(await failureOf(signCompactJws({}, PAYLOAD, signer as Signer)), message).toStrictEqual(
        new DataError(message),
      );
    }
  });

  it("refuses a header or a payload of another type", async () => {
    const { signer } = await signing();
    expect(await failureOf(signCompactJws(JSON.parse("null"), PAYLOAD, signer))).toStrictEqual(
      new DataError("The header must be an object, found null."),
    );
    expect(await failureOf(signCompactJws({}, JSON.parse('"text"'), signer))).toStrictEqual(
      new DataError('The payload must be a Uint8Array, found "text".'),
    );
    expect(await failureOf(signCompactJws({ big: 1n }, PAYLOAD, signer))).toStrictEqual(
      new DataError("The header must be plain data that JSON can hold."),
    );
  });

  it("gives the signer the signal of the caller, and ends the wait when it aborts", async () => {
    const { signer } = await signing();
    const seen: (AbortSignal | undefined)[] = [];
    const watching: Signer = {
      algorithm: signer.algorithm,
      sign: (data, options) => {
        seen.push(options?.signal);
        return signer.sign(data);
      },
    };
    const controller = new AbortController();
    await signCompactJws({}, PAYLOAD, watching, { signal: controller.signal });
    expect(seen).toStrictEqual([controller.signal]);
    const reason = new Error("Stop.");
    const hanging: Signer = { algorithm: "ES256", sign: () => new Promise<Uint8Array>(() => undefined) };
    const pending = failureOf(signCompactJws({}, PAYLOAD, hanging, { signal: controller.signal }));
    controller.abort(reason);
    expect(await pending).toBe(reason);
  });

  it("calls no signer when the signal is aborted before the call", async () => {
    const { signer } = await signing();
    const { signer: spy, calls } = counting(signer);
    const reason = new Error("Already over.");
    expect(await failureOf(signCompactJws({}, PAYLOAD, spy, { signal: AbortSignal.abort(reason) }))).toBe(reason);
    expect(calls()).toBe(0);
  });

  it("signs the ASCII bytes of the encoded header and payload, which a verifier recomputes", async () => {
    const { pair, signer } = await signing();
    const seen: Uint8Array[] = [];
    const spy: Signer = {
      algorithm: signer.algorithm,
      sign: (data, options) => {
        seen.push(data);
        return signer.sign(data, options);
      },
    };
    const jws = await signCompactJws({ typ: "JWT" }, PAYLOAD, spy);
    expect(decoder.decode(seen[0])).toBe(jws.slice(0, jws.lastIndexOf(".")));
    await expect(compactVerify(jws, pair.publicKey)).resolves.toBeDefined();
  });

  it("refuses a signal that is not an AbortSignal, before the signer is called", async () => {
    const { signer } = await signing();
    const { signer: spy, calls } = counting(signer);
    const options = JSON.parse('{"signal":{"aborted":false}}');
    const message = "The option signal must be an AbortSignal, found an object.";
    expect(await failureOf(signCompactJws({}, PAYLOAD, spy, options))).toStrictEqual(new DataError(message));
    expect(await failureOf(signer.sign(PAYLOAD, options))).toStrictEqual(new DataError(message));
    expect(calls()).toBe(0);
  });
});
