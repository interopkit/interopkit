import { createCryptoKeySigner, signCompactJws } from "@interopkit/core";
import { expect, test } from "vitest";
import { alternate, expectRatioWithin } from "./budgets.js";

const encoder = new TextEncoder();

test("signs a compact JWS near Web Crypto alone", async ({ annotate, bench }) => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const signer = createCryptoKeySigner(pair.privateKey, { algorithm: "EdDSA", keyId: "https://issuer.example/keys/1" });
  const payload = encoder.encode(
    JSON.stringify({ iss: "https://issuer.example", sub: "learner", claims: "x".repeat(2000) }),
  );
  const jws = await signCompactJws({ typ: "JWT" }, payload, signer);
  expect(jws.split(".")).toHaveLength(3);
  const input = encoder.encode(`${jws.split(".")[0]}.${jws.split(".")[1]}`);
  const sides = await alternate(bench, "signCompactJws", () => signCompactJws({ typ: "JWT" }, payload, signer), {
    name: "crypto.subtle.sign of the signing input",
    run: () => crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, input),
  });
  await expectRatioWithin(annotate, "signCompactJws", "crypto.subtle.sign", sides);
});
