import { DataError } from "@interopkit/core";
import { p256 } from "@noble/curves/nist.js";
import { hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import {
  createProofKey,
  importIssuerKey,
  importMultikey,
  proofKeyOf,
  signStatement,
  verifyStatements,
} from "../src/keys/index.js";
import { encodeMultikey } from "../src/keys/internal.js";
import { fixRandomBytes } from "./random.js";

describe("the key of a proof", () => {
  it("is made from the bytes of crypto.getRandomValues and from nothing else", () => {
    const seed = Uint8Array.from({ length: 48 }, (_, index) => index + 1);
    // The curve library blinds its computations with 16 more random bytes, which this does not touch.
    const restore = fixRandomBytes(seed);
    const key = createProofKey();
    restore();
    expect(key.secretKey).toStrictEqual(p256.utils.randomSecretKey(seed));
    expect(key.secretKey).toHaveLength(32);
    expect(key.publicKey).toHaveLength(35);
    expect(Array.from(key.publicKey.subarray(0, 2))).toStrictEqual([0x80, 0x24]);
    expect(createProofKey().secretKey).not.toStrictEqual(key.secretKey);
  });

  it("has the public key of its private key in multikey form", () => {
    // The public key of the private key in RFC 6979 appendix A.2.5.
    const secretKey = hex.decode("c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721");
    expect(hex.encode(proofKeyOf(secretKey).publicKey)).toBe(
      "8024" + "0360fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6",
    );
  });
});

describe("the signature of a statement", () => {
  it("is the deterministic ECDSA signature of RFC 6979, which is not always the low-S form", () => {
    // RFC 6979 appendix A.2.5, P-256 with SHA-256, the message "sample": its S is above half the order.
    const secretKey = hex.decode("c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721");
    expect(hex.encode(signStatement(secretKey, "sample"))).toBe(
      "efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716" +
        "f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8",
    );
  });

  it("is checked against the statement it belongs to, in order", async () => {
    const key = createProofKey();
    const statements = ["<a> <b> <c> .\n", "<d> <e> <f> .\n"];
    const signatures = statements.map((statement) => signStatement(key.secretKey, statement));
    const publicKey = await importMultikey(key.publicKey);
    expect(await verifyStatements(publicKey, statements, signatures)).toBe(true);
    expect(await verifyStatements(publicKey, statements, [...signatures].reverse())).toBe(false);
  });

  it("is refused when it does not count one for each statement", async () => {
    const key = createProofKey();
    const statements = ["<a> <b> <c> .\n"];
    const signature = signStatement(key.secretKey, statements[0] ?? "");
    const publicKey = await importMultikey(key.publicKey);
    expect(await verifyStatements(publicKey, statements, [signature, signature])).toBe(false);
    expect(await verifyStatements(publicKey, statements, [])).toBe(false);
  });

  it("is refused when only one of several is wrong", async () => {
    const key = createProofKey();
    const statements = ["<a> <b> <c> .\n", "<d> <e> <f> .\n", "<g> <h> <i> .\n"];
    const signatures = statements.map((statement) => signStatement(key.secretKey, statement));
    signatures[1] = signStatement(key.secretKey, "<other> <b> <c> .\n");
    expect(await verifyStatements(await importMultikey(key.publicKey), statements, signatures)).toBe(false);
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
