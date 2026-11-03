import { createCryptoKeySigner } from "@interopkit/core";
import { readStatement } from "@interopkit/learning-records";
import { signStatement, verifyStatementSignature } from "@interopkit/learning-records/signing";
import { CompactSign, compactVerify } from "jose";
import { beforeAll, expect, test } from "vitest";
import { benchStatement } from "./batch.js";
import { BENCH_OPTIONS, expectRatio, RATIOS } from "./budgets.js";

let keys: CryptoKeyPair;
beforeAll(async () => {
  keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
});

test("signs and verifies a Statement within a few times of the JWS of jose alone", async ({ annotate, bench }) => {
  const statement = readStatement(benchStatement(1));
  const payload = new TextEncoder().encode(JSON.stringify(statement));
  const signer = createCryptoKeySigner(keys.privateKey, { algorithm: "RS256" });
  const { statement: signed, signature } = await signStatement(statement, signer);
  expect(await verifyStatementSignature(signed, signature.body, { key: keys.publicKey })).toStrictEqual({
    valid: true,
    certified: false,
  });

  const jose = await bench("jose CompactSign", async () => {
    await new CompactSign(payload).setProtectedHeader({ alg: "RS256" }).sign(keys.privateKey);
  }).run(BENCH_OPTIONS);
  const ours = await bench("signStatement", async () => {
    await signStatement(statement, signer);
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "signStatement",
    ours,
    { ...jose, name: "the CompactSign of jose" },
    RATIOS.signAgainstJose,
  );

  const jws = new TextDecoder().decode(signature.body);
  const joseVerify = await bench("jose compactVerify", async () => {
    await compactVerify(jws, keys.publicKey, { algorithms: ["RS256"] });
  }).run(BENCH_OPTIONS);
  const verified = await bench("verifyStatementSignature", async () => {
    await verifyStatementSignature(signed, signature.body, { key: keys.publicKey });
  }).run(BENCH_OPTIONS);
  await expectRatio(
    annotate,
    "verifyStatementSignature",
    verified,
    { ...joseVerify, name: "the compactVerify of jose" },
    RATIOS.verifyAgainstJose,
  );
});
