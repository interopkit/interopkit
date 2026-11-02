import { createJwksCache } from "@interopkit/tool-integration";
import { createLocalJWKSet, createRemoteJWKSet, customFetch, type JSONWebKeySet } from "jose";
import { expect, test } from "vitest";
import { CLOCK } from "./bench-setup.js";
import { expectRatioInTurns } from "./budgets.js";

const URL_OF_SET = "https://lms.example.edu/jwks";
/** The keys of a platform in the middle of a rotation: an RSA key and an elliptic curve key, the second the one that signs. */
const KEYS = 2;
/** The resolutions in one sample: one takes about a microsecond, below what a sample measures well. */
const RESOLUTIONS = 1000;

/** Resolves the key of a header as many times as a sample holds. */
async function resolveMany(resolve: () => unknown): Promise<void> {
  for (let index = 0; index < RESOLUTIONS; index += 1) await resolve();
}

/** A key set of RSA and elliptic curve keys, as a platform that rotates its keys publishes it. */
async function keySet(): Promise<JSONWebKeySet> {
  const parameters = [
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    { name: "ECDSA", namedCurve: "P-256" },
  ] as const;
  const keys = [];
  for (let index = 0; index < KEYS; index += 1) {
    const pair = (await crypto.subtle.generateKey(parameters[index % 2] ?? parameters[0], true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const alg = index % 2 === 0 ? "RS256" : "ES256";
    keys.push({ ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: `key-${index}`, alg, use: "sig" });
  }
  return { keys };
}

test("resolves a key from a cached key set 1,000 times within a multiple of jose's own sets", async ({
  annotate,
  bench,
}) => {
  const set = await keySet();
  const fetch = async () => Response.json(set);
  const header = { alg: "ES256", kid: `key-${KEYS - 1}` };
  const token = { payload: "", signature: "" };
  const cache = createJwksCache({ fetch, clock: CLOCK });
  const local = createLocalJWKSet(set);
  const remote = createRemoteJWKSet(new URL(URL_OF_SET), { [customFetch]: fetch });
  // Each holds the set and has imported the key before it is timed, as on every request after the first.
  for (const resolve of [cache.keySet(URL_OF_SET), local, remote]) {
    expect(await resolve(header, token)).toMatchObject({ type: "public", algorithm: { name: "ECDSA" } });
  }

  await expectRatioInTurns(
    { annotate, bench },
    "jwksAgainstLocal",
    { name: "createLocalJWKSet of jose", fn: () => resolveMany(() => local(header, token)) },
    { name: "the key set cache", fn: () => resolveMany(() => cache.keySet(URL_OF_SET)(header, token)) },
  );
  await expectRatioInTurns(
    { annotate, bench },
    "jwksAgainstRemote",
    { name: "createRemoteJWKSet of jose", fn: () => resolveMany(() => remote(header, token)) },
    { name: "the key set cache", fn: () => resolveMany(() => cache.keySet(URL_OF_SET)(header, token)) },
  );
});
