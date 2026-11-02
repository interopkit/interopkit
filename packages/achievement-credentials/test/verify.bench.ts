import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import * as didKey from "@digitalbazaar/did-method-key";
import * as Ed25519Multikey from "@digitalbazaar/ed25519-multikey";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import * as vc from "@digitalbazaar/vc";
import { buildAchievementCredential } from "@interopkit/achievement-credentials";
import { addProof, createContextLoader } from "@interopkit/achievement-credentials/data-integrity";
import { signCredentialJwt } from "@interopkit/achievement-credentials/jwt";
import { createKeyResolver } from "@interopkit/achievement-credentials/keys";
import { verifyCredential } from "@interopkit/achievement-credentials/verify";
import { verifyCredential as jwtVerify } from "did-jwt-vc";
import { expect, test } from "vitest";
import { BENCH_OPTIONS, expectRatioWithin } from "./budgets.js";
import { downloadedContexts } from "./downloaded-contexts.js";
import { clockAt, KEYS, signerOf } from "./key-fixtures.js";

const CONTEXTS = downloadedContexts();
const NOW = Date.UTC(2026, 10, 1);
const clock = clockAt(NOW);
const did = `did:key:${KEYS.ed25519.multikey}`;
const method = `${did}#${KEYS.ed25519.multikey}`;

const didKeyDriver = didKey.driver();
didKeyDriver.use({ multibaseMultikeyHeader: "z6Mk", fromMultibase: Ed25519Multikey.from });
const documentLoader = async (url: string) => {
  const context = CONTEXTS.get(url);
  if (context !== undefined) return { contextUrl: null, documentUrl: url, document: structuredClone(context) };
  if (url.startsWith("did:key:"))
    return { contextUrl: null, documentUrl: url, document: await didKeyDriver.get({ url }) };
  throw new Error(`The benchmark serves no document for ${url}.`);
};

const credential = buildAchievementCredential({
  id: "https://example.edu/credentials/1",
  issuer: { id: did, type: ["Profile"], name: "Example University" },
  validFrom: "2026-10-01T00:00:00Z",
  name: "Fractions badge",
  subject: { id: "did:example:learner" },
  achievement: {
    id: "https://example.edu/achievements/1",
    type: ["Achievement"],
    name: "Fractions",
    description: "Understands fractions as numbers.",
    criteria: { narrative: "Pass the final assessment." },
  },
});

test("verifies a credential in a JWS as fast as did-jwt-vc, which checks far less", async ({ annotate, bench }) => {
  const jws = await signCredentialJwt(credential, signerOf(KEYS.ed25519, method), { kid: method });
  const keys = createKeyResolver({ clock });
  const resolver = {
    resolve: async () => ({
      didResolutionMetadata: {},
      didDocumentMetadata: {},
      didDocument: {
        id: did,
        verificationMethod: [
          { id: method, type: "JsonWebKey2020", controller: did, publicKeyJwk: KEYS.ed25519.publicJwk },
        ],
        authentication: [method],
        assertionMethod: [method],
      },
    }),
  };
  const policies = { format: false, now: NOW / 1000 };
  const ours = () => verifyCredential(jws, { keys, clock });
  const theirs = () => jwtVerify(jws, resolver as never, { policies });
  expect((await ours()).verified).toBe(true);
  expect((await theirs()).verified).toBe(true);
  const reference = await bench("did-jwt-vc", theirs).run(BENCH_OPTIONS);
  const result = await bench("verifyCredential of a JWS", ours).run(BENCH_OPTIONS);
  await expectRatioWithin(annotate, "jwt", "did-jwt-vc", result, reference);
});

test("verifies a credential with a Data Integrity proof as fast as Digital Bazaar's vc", async ({
  annotate,
  bench,
}) => {
  const contexts = createContextLoader({ documents: CONTEXTS });
  const signed = await addProof(credential, signerOf(KEYS.ed25519, method), { clock, contexts });
  const keys = createKeyResolver({ clock });
  const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
  const ours = () => verifyCredential(signed, { keys, clock, contexts });
  const theirs = () => vc.verifyCredential({ credential: structuredClone(signed), suite, documentLoader });
  expect((await ours()).verified).toBe(true);
  expect((await theirs()).verified).toBe(true);
  const reference = await bench("Digital Bazaar vc", theirs).run(BENCH_OPTIONS);
  const result = await bench("verifyCredential with eddsa-rdfc-2022", ours).run(BENCH_OPTIONS);
  await expectRatioWithin(annotate, "dataIntegrity", "Digital Bazaar's vc", result, reference);
});
