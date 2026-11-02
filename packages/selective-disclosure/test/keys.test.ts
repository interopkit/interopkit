import { DataError } from "@interopkit/core";
import { p256 } from "@noble/curves/nist.js";
import { base64urlnopad, hex } from "@scure/base";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProofKey, importIssuerKey, importMultikey, verifyStatements } from "../src/keys/index.js";
import { encodeMultikey } from "../src/keys/internal.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The key pairs that Web Crypto makes while a function runs. */
async function pairsMadeBy(make: () => Promise<unknown>): Promise<CryptoKeyPair[]> {
  const generateKey = crypto.subtle.generateKey.bind(crypto.subtle);
  const pairs: CryptoKeyPair[] = [];
  vi.spyOn(crypto.subtle, "generateKey").mockImplementation(async (...parameters: Parameters<typeof generateKey>) => {
    const made = await generateKey(...parameters);
    if ("privateKey" in made) pairs.push(made);
    return made;
  });
  await make();
  return pairs;
}

describe("the key of a proof", () => {
  it("is a new P-256 key pair of Web Crypto, whose private key signs and cannot be exported", async () => {
    let key: Awaited<ReturnType<typeof createProofKey>> | undefined;
    const [pair] = await pairsMadeBy(async () => {
      key = await createProofKey();
    });
    expect(pair?.privateKey.algorithm).toStrictEqual({ name: "ECDSA", namedCurve: "P-256" });
    expect(pair?.privateKey.extractable).toBe(false);
    expect(pair?.privateKey.usages).toStrictEqual(["sign"]);
    expect(key?.publicKey).not.toStrictEqual((await createProofKey()).publicKey);
  });

  it("carries the public key of the pair as a compressed point in multikey form", async () => {
    let key: Awaited<ReturnType<typeof createProofKey>> | undefined;
    const [pair] = await pairsMadeBy(async () => {
      key = await createProofKey();
    });
    if (pair === undefined || key === undefined) throw new Error("No key pair was made.");
    const { x, y } = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const yBytes = base64urlnopad.decode(y ?? "");
    // SEC 1, section 2.3.3: 2 for an even y and 3 for an odd one, then x.
    const prefix = (yBytes.at(-1) ?? 0) % 2 === 0 ? "02" : "03";
    expect(hex.encode(key.publicKey)).toBe(`8024${prefix}${hex.encode(base64urlnopad.decode(x ?? ""))}`);
  });
});

describe("the signature of a statement", () => {
  it("is the 64 bytes of R and S, and verifies under the public key of the proof", async () => {
    const key = await createProofKey();
    const signature = await key.sign("<a> <b> <c> .\n");
    expect(signature).toHaveLength(64);
    expect(await verifyStatements(await importMultikey(key.publicKey), ["<a> <b> <c> .\n"], [signature])).toBe(true);
  });

  it("is checked against the statement it belongs to, in order", async () => {
    const key = await createProofKey();
    const statements = ["<a> <b> <c> .\n", "<d> <e> <f> .\n"];
    const signatures = await Promise.all(statements.map((statement) => key.sign(statement)));
    const publicKey = await importMultikey(key.publicKey);
    expect(await verifyStatements(publicKey, statements, signatures)).toBe(true);
    expect(await verifyStatements(publicKey, statements, [...signatures].reverse())).toBe(false);
  });

  it("is refused when it does not count one for each statement", async () => {
    const key = await createProofKey();
    const statements = ["<a> <b> <c> .\n"];
    const signature = await key.sign(statements[0] ?? "");
    const publicKey = await importMultikey(key.publicKey);
    expect(await verifyStatements(publicKey, statements, [signature, signature])).toBe(false);
    expect(await verifyStatements(publicKey, statements, [])).toBe(false);
  });

  it("is refused when only one of several is wrong", async () => {
    const key = await createProofKey();
    const statements = ["<a> <b> <c> .\n", "<d> <e> <f> .\n", "<g> <h> <i> .\n"];
    const signatures = await Promise.all(statements.map((statement) => key.sign(statement)));
    signatures[1] = await key.sign("<other> <b> <c> .\n");
    expect(await verifyStatements(await importMultikey(key.publicKey), statements, signatures)).toBe(false);
  });

  it("verifies in the form that is not low-S, as other implementations may sign", async () => {
    // RFC 6979 appendix A.2.5, P-256 with SHA-256, the message "sample": its S is above half the order.
    const secretKey = hex.decode("c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721");
    const signature = hex.decode(
      "efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716" +
        "f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8",
    );
    const publicKey = await importMultikey(encodeMultikey(p256.getPublicKey(secretKey, true)));
    expect(await verifyStatements(publicKey, ["sample"], [signature])).toBe(true);
  });
});

/** The 33 bytes of a compressed point with the given small x and an even y. */
function compressed(x: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes[0] = 2;
  bytes[32] = x;
  return bytes;
}

describe("the public key of a proof", () => {
  it("is refused when its bytes are no point of the curve", async () => {
    // The first x that no point of the curve has.
    const missing = Array.from({ length: 20 }, (_, x) => x + 1).find(
      (x) => !p256.utils.isValidPublicKey(compressed(x), true),
    );
    expect(missing).toBeDefined();
    await expect(importMultikey(encodeMultikey(compressed(missing ?? 0)))).rejects.toThrow(
      /not a point of the curve P-256/,
    );
    await expect(importMultikey(encodeMultikey(new Uint8Array(33).fill(0xff)))).rejects.toThrow(DataError);
  });
});

describe("the key of the issuer", () => {
  it("is a P-256 public key of a JWK", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    expect(await importIssuerKey(await crypto.subtle.exportKey("jwk", pair.publicKey))).toBeInstanceOf(CryptoKey);
  });

  it("is nothing when the JWK is of another kind or curve, or its point is not on the curve", async () => {
    const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
    expect(await importIssuerKey(await crypto.subtle.exportKey("jwk", other.publicKey))).toBeUndefined();
    expect(await importIssuerKey({ kty: "OKP", crv: "Ed25519", x: "AAAA" })).toBeUndefined();
    expect(await importIssuerKey({ kty: "EC", crv: "P-256", x: "AAAA", y: "AAAA" })).toBeUndefined();
    expect(await importIssuerKey({ kty: "EC", crv: "P-256" })).toBeUndefined();
  });

  it("is refused when the JWK holds a private key", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    await expect(importIssuerKey(await crypto.subtle.exportKey("jwk", pair.privateKey))).rejects.toThrow(
      /holds a private key/,
    );
  });

  it("ignores the members of a JWK that say how it may be used", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = {
      ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
      key_ops: ["sign"],
      alg: "ES384",
      use: "enc",
    };
    expect(await importIssuerKey(jwk)).toBeInstanceOf(CryptoKey);
  });
});
