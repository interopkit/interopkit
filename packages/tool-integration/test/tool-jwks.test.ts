import { createCryptoKeySigner, DataError, signCompactJws } from "@interopkit/core";
import { createLocalJWKSet, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import type { KeySet } from "../src/index.js";
import { serveToolJwks } from "../src/tool/index.js";
import { request } from "./fixture.js";
import { textOf } from "./text-of.js";

/**
 * The tool's key set, as Security Framework 1.1 sections 6.3 and 6.4 describe it: every key with a `kid`, and the keys of a
 * rotation side by side. A platform reads the set with jose, as an independent verifier.
 */

const URL_OF_SET = "https://tool.example.com/.well-known/jwks.json";
const encoder = new TextEncoder();

/** A key pair of the algorithm, as a signer and the public JWK that the tool publishes. */
async function keyOf(algorithm: "RS256" | "ES256", kid: string) {
  const parameters =
    algorithm === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }
      : { name: "ECDSA", namedCurve: "P-256" };
  const pair = (await crypto.subtle.generateKey(parameters, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    signer: createCryptoKeySigner(pair.privateKey, { algorithm, keyId: kid }),
    publicKey: { ...jwk, kid, alg: algorithm, use: "sig" } as JsonWebKey,
  };
}

const old = await keyOf("RS256", "tool-2026-10");
const next = await keyOf("ES256", "tool-2026-11");

/** Signs a token with a signer, as the tool signs a client assertion. */
function tokenOf(signer: KeySet["signer"]): Promise<string> {
  return signCompactJws({ typ: "JWT" }, encoder.encode(JSON.stringify({ iss: "tool-1", aud: "platform" })), signer);
}

describe("serveToolJwks", () => {
  it("serves every public key of a rotation, so that a platform verifies tokens of the old and the new signer", async () => {
    const keys: KeySet = { signer: next.signer, publicKeys: [old.publicKey, next.publicKey] };
    const answer = serveToolJwks(request({ url: URL_OF_SET }), keys);
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("application/json;charset=UTF-8");
    expect(answer.headers["cache-control"]).toBe("public, max-age=3600");
    const set = JSON.parse(textOf(answer.body));
    expect(set).toStrictEqual({ keys: [old.publicKey, next.publicKey] });
    const platform = createLocalJWKSet(set);
    for (const signer of [old.signer, next.signer]) {
      const { protectedHeader } = await jwtVerify(await tokenOf(signer), platform);
      expect(protectedHeader.kid).toBe(signer.keyId);
    }
  });

  it("answers HEAD with the headers and no body, another method with 405, and caches as long as it is told", () => {
    const keys: KeySet = { signer: old.signer, publicKeys: [old.publicKey] };
    const head = serveToolJwks(request({ url: URL_OF_SET, method: "HEAD" }), keys);
    expect(head).toMatchObject({ status: 200, body: "", headers: { "cache-control": "public, max-age=3600" } });
    expect(serveToolJwks(request({ url: URL_OF_SET, method: "POST" }), keys)).toStrictEqual({
      status: 405,
      headers: { allow: "GET, HEAD" },
      body: "",
    });
    const brief = serveToolJwks(request({ url: URL_OF_SET }), keys, { maxAgeSeconds: 0 });
    expect(brief.headers["cache-control"]).toBe("public, max-age=0");
  });

  it("publishes no private key, no kid twice and no set without the signer's key", () => {
    const answer = (keys: unknown) => () => serveToolJwks(request({ url: URL_OF_SET }), keys as KeySet);
    expect(answer({ signer: old.signer, publicKeys: [{ ...old.publicKey, d: "AQAB" }] })).toThrow(
      new DataError(
        'The public key 0 of the key set must be a public key, and it has the member "d" of a private key.',
      ),
    );
    expect(
      answer({ signer: old.signer, publicKeys: [old.publicKey, { ...next.publicKey, kid: old.signer.keyId }] }),
    ).toThrow(DataError);
    expect(answer({ signer: next.signer, publicKeys: [old.publicKey] })).toThrow(
      new DataError('The keyId of the signer must be the kid of one of the public keys, found "tool-2026-11".'),
    );
  });

  it("refuses a request, a key set and options of other types", () => {
    const keys: KeySet = { signer: old.signer, publicKeys: [old.publicKey] };
    expect(() => serveToolJwks(JSON.parse("null"), keys)).toThrow(DataError);
    expect(() => serveToolJwks(request({ url: URL_OF_SET }), JSON.parse("null"))).toThrow(
      new DataError("The key set must be an object, found null."),
    );
    expect(() => serveToolJwks(request({ url: URL_OF_SET }), keys, JSON.parse("null"))).toThrow(
      new DataError("The options is invalid: expected an object, found null."),
    );
    expect(() => serveToolJwks(request({ url: URL_OF_SET }), keys, { maxAgeSeconds: JSON.parse('"60"') })).toThrow(
      new DataError('The options is invalid at maxAgeSeconds: expected a number, found "60".'),
    );
    expect(() => serveToolJwks(request({ url: URL_OF_SET }), keys, { maxAge: 60 } as never)).toThrow(
      new DataError('The options is invalid: unexpected property "maxAge".'),
    );
  });
});
