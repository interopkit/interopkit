import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import * as vc from "@digitalbazaar/vc";
import { verifyCredential as interopVerify } from "@interop/verifier-core";
import { buildClrCredential } from "@interopkit/achievement-credentials";
import { addProof } from "@interopkit/achievement-credentials/data-integrity";
import { signCredentialJwt } from "@interopkit/achievement-credentials/jwt";
import { createKeyResolver } from "@interopkit/achievement-credentials/keys";
import { verifyCredential } from "@interopkit/achievement-credentials/verify";
import { verifyCredential as jwtVerify } from "did-jwt-vc";
import { expect, test } from "vitest";
import { clock, contexts, credentialOf, issuerOf, NOW, referenceLoader } from "./bench-fixtures.js";
import { alternate, expectRatioWithin } from "./budgets.js";
import { KEYS } from "./key-fixtures.js";

const issuer = issuerOf(KEYS.ed25519);
const credential = credentialOf(issuer.did);
/** The credentials that the CLR of the benchmark holds: a transcript of a term. */
const HELD = 10;

/** The resolver of did-jwt-vc, which gives the document of the issuer with its key. */
const resolver = {
  resolve: async () => ({
    didResolutionMetadata: {},
    didDocumentMetadata: {},
    didDocument: {
      id: issuer.did,
      verificationMethod: [
        { id: issuer.method, type: "JsonWebKey2020", controller: issuer.did, publicKeyJwk: KEYS.ed25519.publicJwk },
      ],
      authentication: [issuer.method],
      assertionMethod: [issuer.method],
    },
  }),
};
const policies = { format: false, now: NOW / 1000 };

test("verifies a credential in a JWS as fast as did-jwt-vc, which checks far less", async ({ annotate, bench }) => {
  const jws = await signCredentialJwt(credential, issuer.signer, { kid: issuer.method });
  const keys = createKeyResolver({ clock });
  const ours = () => verifyCredential(jws, { keys, clock });
  const theirs = () => jwtVerify(jws, resolver as never, { policies });
  expect((await ours()).verified).toBe(true);
  expect((await theirs()).verified).toBe(true);
  const sides = await alternate(bench, "verifyCredential of a JWS", ours, { name: "did-jwt-vc", run: theirs });
  await expectRatioWithin(annotate, "jwt", "did-jwt-vc", sides);
});

test("verifies a CLR of 10 credentials in JWS as fast as did-jwt-vc verifies the 11 JWTs", async ({
  annotate,
  bench,
}) => {
  const held = await Promise.all(
    Array.from({ length: HELD }, (_, index) =>
      signCredentialJwt({ ...credential, id: `https://example.edu/credentials/${index + 1}` }, issuer.signer, {
        kid: issuer.method,
      }),
    ),
  );
  const clr = buildClrCredential({
    id: "https://example.edu/clrs/1",
    issuer: { id: issuer.did, type: ["Profile"], name: "Example University" },
    validFrom: "2026-10-01T00:00:00Z",
    name: "Transcript of the term",
    subject: { id: "did:example:learner" },
    credentials: held,
  });
  const jws = await signCredentialJwt(clr, issuer.signer, { kid: issuer.method });
  const keys = createKeyResolver({ clock });
  const ours = () => verifyCredential(jws, { keys, clock });
  const theirs = () => Promise.all([jws, ...held].map((each) => jwtVerify(each, resolver as never, { policies })));
  const result = await ours();
  expect(result.verified).toBe(true);
  expect(result.nested).toHaveLength(HELD);
  expect((await theirs()).every(({ verified }) => verified)).toBe(true);
  const sides = await alternate(bench, "verifyCredential of a CLR", ours, {
    name: "did-jwt-vc of 11 JWTs",
    run: theirs,
  });
  await expectRatioWithin(annotate, "clr", "did-jwt-vc of the 11 JWTs", sides);
});

test("verifies a credential with a Data Integrity proof as fast as Digital Bazaar's vc and the verifier of the Interop Alliance", async ({
  annotate,
  bench,
}) => {
  const signed = await addProof(credential, issuer.signer, { clock, contexts });
  const keys = createKeyResolver({ clock });
  const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
  const ours = () => verifyCredential(signed, { keys, clock, contexts });
  const digitalBazaar = () =>
    vc.verifyCredential({ credential: structuredClone(signed), suite, documentLoader: referenceLoader });
  const timeService = { dateNowMs: () => NOW, performanceNowMs: () => 0 };
  const interop = () =>
    interopVerify({ credential: structuredClone(signed), documentLoader: referenceLoader, timeService } as never);
  expect((await ours()).verified).toBe(true);
  expect((await digitalBazaar()).verified).toBe(true);
  expect((await interop()).verified).toBe(true);
  const name = "verifyCredential with eddsa-rdfc-2022";
  const againstVc = await alternate(bench, name, ours, { name: "Digital Bazaar vc", run: digitalBazaar });
  await expectRatioWithin(annotate, "dataIntegrity", "Digital Bazaar's vc", againstVc);
  const againstInterop = await alternate(bench, name, ours, { name: "@interop/verifier-core", run: interop });
  await expectRatioWithin(annotate, "dataIntegrityInterop", "@interop/verifier-core", againstInterop);
});
