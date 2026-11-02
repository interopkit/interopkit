import { readCredentialJwt, signCredentialJwt } from "@interopkit/achievement-credentials/jwt";
import { createKeyResolver } from "@interopkit/achievement-credentials/keys";
import { EdDSASigner } from "did-jwt";
import { createVerifiableCredentialJwt, verifyCredential as jwtVerify } from "did-jwt-vc";
import { exportJWK } from "jose";
import { expect, test } from "vitest";
import { clock, credentialOf, issuerOf, NOW } from "./bench-fixtures.js";
import { alternate, expectRatioWithin } from "./budgets.js";
import { KEYS } from "./key-fixtures.js";

const V1_CONTEXT = "https://www.w3.org/2018/credentials/v1";
const OB_CONTEXT = "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json";
const issuer = issuerOf(KEYS.ed25519);
const credential = credentialOf(issuer.did);

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

test("reads and signs a credential in a JWS as fast as did-jwt-vc", async ({ annotate, bench }) => {
  const jws = await signCredentialJwt(credential, issuer.signer, { kid: issuer.method });
  const keys = createKeyResolver({ clock });
  const policies = { format: false, now: NOW / 1000 };
  expect((await readCredentialJwt(jws, { keys, clock })).valid).toBe(true);
  expect((await jwtVerify(jws, resolver as never, { policies })).verified).toBe(true);
  const reading = await alternate(bench, "readCredentialJwt", () => readCredentialJwt(jws, { keys, clock }), {
    name: "did-jwt-vc verifyCredential",
    run: () => jwtVerify(jws, resolver as never, { policies }),
  });
  await expectRatioWithin(annotate, "readCredentialJwt", "did-jwt-vc", reading);

  const privateJwk = await exportJWK(KEYS.ed25519.privateKey);
  const theirs = { did: issuer.did, alg: "EdDSA", signer: EdDSASigner(Buffer.from(String(privateJwk.d), "base64url")) };
  // did-jwt-vc writes the claim vc of the Data Model 1.1, which names its context and issuanceDate.
  const { validFrom, "@context": _context, ...rest } = credential;
  const vc = { ...rest, "@context": [V1_CONTEXT, OB_CONTEXT], issuanceDate: validFrom };
  const payload = { sub: "did:example:learner", nbf: Date.parse(validFrom) / 1000, vc };
  expect(await createVerifiableCredentialJwt(payload as never, theirs)).toMatch(/^ey/u);
  const signing = await alternate(
    bench,
    "signCredentialJwt",
    () => signCredentialJwt(credential, issuer.signer, { kid: issuer.method }),
    {
      name: "did-jwt-vc createVerifiableCredentialJwt",
      run: () => createVerifiableCredentialJwt(payload as never, theirs, { header: { kid: issuer.method } }),
    },
  );
  await expectRatioWithin(annotate, "signCredentialJwt", "did-jwt-vc", signing);
});
