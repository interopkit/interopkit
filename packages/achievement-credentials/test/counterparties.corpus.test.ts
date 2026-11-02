import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import * as didKey from "@digitalbazaar/did-method-key";
import * as Ed25519Multikey from "@digitalbazaar/ed25519-multikey";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import * as vc from "@digitalbazaar/vc";
import { verifyCredential as dccVerify } from "@digitalcredentials/verifier-core";
import { verifyCredential as interopVerify } from "@interop/verifier-core";
import { EdDSASigner } from "did-jwt";
import { createVerifiableCredentialJwt, verifyCredential as jwtVerify } from "did-jwt-vc";
import { exportJWK } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addProof, createContextLoader, verifyProof } from "../src/data-integrity/index.js";
import { buildAchievementCredential, type IssuableCredential } from "../src/index.js";
import { signCredentialJwt } from "../src/jwt/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { verifyCredential } from "../src/verify/index.js";
import { downloadedContexts, downloadedFile } from "./downloaded-contexts.js";
import { clockAt, KEYS, signerOf } from "./key-fixtures.js";

const CONTEXTS = downloadedContexts();
const NOW = Date.UTC(2026, 10, 1);
const clock = clockAt(NOW);
const contexts = createContextLoader({ documents: CONTEXTS });
const keys = createKeyResolver({ clock });
const options = { keys, clock, contexts };

/** The resolver of `did:key` in Digital Bazaar's stack. */
const didKeyDriver = didKey.driver();
didKeyDriver.use({ multibaseMultikeyHeader: "z6Mk", fromMultibase: Ed25519Multikey.from });

/** The loader of the counterparties: the downloaded contexts, and the keys of `did:key`. */
const documentLoader = async (url: string) => {
  const context = CONTEXTS.get(url);
  if (context !== undefined) return { contextUrl: null, documentUrl: url, document: structuredClone(context) };
  if (url.startsWith("did:key:"))
    return { contextUrl: null, documentUrl: url, document: await didKeyDriver.get({ url }) };
  throw new Error(`The test serves no document for ${url}.`);
};

/** An issuer with a key of its own. */
interface Issuer {
  readonly did: string;
  readonly method: string;
}

const OURS: Issuer = {
  did: `did:key:${KEYS.ed25519.multikey}`,
  method: `did:key:${KEYS.ed25519.multikey}#${KEYS.ed25519.multikey}`,
};

/** Digital Bazaar's key, a key pair of their Multikey with the identifiers of its own `did:key`. */
async function digitalBazaarKey() {
  const key = await Ed25519Multikey.generate();
  const did = `did:key:${key.publicKeyMultibase}`;
  key.controller = did;
  key.id = `${did}#${key.publicKeyMultibase}`;
  return { key, issuer: { did, method: key.id } satisfies Issuer };
}

/** The credential that an issuer awards. */
function credentialOf(issuer: Issuer) {
  return buildAchievementCredential({
    id: "https://example.edu/credentials/1",
    issuer: { id: issuer.did, type: ["Profile"], name: "Example University" },
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
}

/** Signs with Digital Bazaar's Data Integrity suite, and verifies with it. */
async function dbSign(credential: IssuableCredential, key: Awaited<ReturnType<typeof digitalBazaarKey>>["key"]) {
  const suite = new DataIntegrityProof({ signer: key.signer(), cryptosuite: eddsaRdfc2022, date: new Date(NOW) });
  return await vc.issue({ credential: structuredClone(credential), suite, documentLoader });
}

async function dbVerify(credential: object): Promise<boolean> {
  const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
  const result = await vc.verifyCredential({ credential: structuredClone(credential), suite, documentLoader });
  return result.verified === true;
}

describe("Digital Bazaar's vc with eddsa-rdfc-2022, as a counterparty", () => {
  it("verifies a credential that we signed, and refuses it once its name changed", async () => {
    const signed = await addProof(credentialOf(OURS), signerOf(KEYS.ed25519, OURS.method), { clock, contexts });
    expect(await dbVerify(signed)).toBe(true);
    expect(await dbVerify({ ...signed, name: "Another badge" })).toBe(false);
  });

  it("issues a credential that we verify as a proof, as Open Badges 9 says, and refuse once its name changed", async () => {
    const { key, issuer } = await digitalBazaarKey();
    const signed = (await dbSign(credentialOf(issuer), key)) as IssuableCredential;
    expect(await verifyProof(signed, options)).toMatchObject({ valid: true, bound: true });
    const result = await verifyCredential(signed, options);
    expect(result.verified).toBe(true);
    expect(result.checks.find(({ check }) => check === "proof")?.outcome).toBe("passed");
    const changed = { ...signed, name: "Another badge" } as IssuableCredential;
    expect(await verifyProof(changed, options)).toMatchObject({ valid: false });
    expect((await verifyCredential(changed, options)).verified).toBe(false);
  });

  it("refuses a credential that the key of another issuer signed, as we do", async () => {
    const { key } = await digitalBazaarKey();
    // The proof names the key of Digital Bazaar's key pair, while the credential names our issuer.
    const signed = (await dbSign(credentialOf(OURS), key)) as IssuableCredential;
    expect(await dbVerify(signed)).toBe(false);
    expect(await verifyProof(signed, options)).toMatchObject({ valid: false });
    expect((await verifyCredential(signed, options)).verified).toBe(false);
  });
});

describe("the verifier of the Interop Alliance, as a counterparty", () => {
  const verify = async (credential: object) =>
    await interopVerify({
      credential,
      documentLoader,
      timeService: { dateNowMs: () => NOW, performanceNowMs: () => 0 },
    });

  it("verifies a credential that we signed, and refuses it once its name changed", async () => {
    const signed = await addProof(credentialOf(OURS), signerOf(KEYS.ed25519, OURS.method), { clock, contexts });
    expect((await verify(signed)).verified).toBe(true);
    expect((await verify({ ...signed, name: "Another badge" })).verified).toBe(false);
  });

  it("verifies the credential that Digital Bazaar signed, as we do", async () => {
    const { key, issuer } = await digitalBazaarKey();
    const signed = await dbSign(credentialOf(issuer), key);
    expect((await verify(signed)).verified).toBe(true);
  });
});

describe("the verifier of the Digital Credentials Consortium, as a counterparty", () => {
  // The verifier fetches the schema that the credential names, and takes no loader: the test serves the pinned download.
  afterEach(() => vi.unstubAllGlobals());
  const serveSchemas = () =>
    vi.stubGlobal("fetch", async (url: unknown) => {
      const address = String(url);
      if (!address.includes("/schema/json/")) throw new Error(`The test serves no document for ${address}.`);
      return new Response(downloadedFile(address), { headers: { "content-type": "application/json" } });
    });
  const verify = async (credential: unknown) => {
    serveSchemas();
    const result = await dccVerify({ credential: credential as never, knownDIDRegistries: [] });
    return {
      steps: Object.fromEntries((result.log ?? []).map(({ id, valid }) => [id, valid])),
      errors: (result.errors ?? []).map(({ name }) => name),
    };
  };

  it("verifies the signature of a credential that we signed, and refuses it once its name changed", async () => {
    const signed = await addProof(credentialOf(OURS), signerOf(KEYS.ed25519, OURS.method), { clock, contexts });
    expect(await verify(signed)).toMatchObject({ steps: { valid_signature: true, expiration: true }, errors: [] });
    // A signature that does not verify is fatal for the verifier, which then says nothing of the other steps.
    expect(await verify({ ...signed, name: "Another badge" })).toStrictEqual({
      steps: {},
      errors: ["invalid_signature"],
    });
  });
});

describe("did-jwt-vc, as a counterparty of the JWT form", () => {
  /** The key of `KEYS.ed25519` as the issuer of did-jwt-vc. */
  async function issuer() {
    const jwk = await exportJWK(KEYS.ed25519.privateKey);
    return { did: OURS.did, alg: "EdDSA", signer: EdDSASigner(Buffer.from(String(jwk.d), "base64url")) };
  }
  const resolver = {
    resolve: async () => ({
      didResolutionMetadata: {},
      didDocumentMetadata: {},
      didDocument: {
        id: OURS.did,
        verificationMethod: [
          { id: OURS.method, type: "JsonWebKey2020", controller: OURS.did, publicKeyJwk: KEYS.ed25519.publicJwk },
        ],
        authentication: [OURS.method],
        assertionMethod: [OURS.method],
      },
    }),
  };

  it("verifies the JWT that we signed, as the key of the issuer, and refuses it once its payload changed", async () => {
    const jws = await signCredentialJwt(credentialOf(OURS), signerOf(KEYS.ed25519, OURS.method), { kid: OURS.method });
    const policies = { format: false, now: NOW / 1000 };
    expect((await jwtVerify(jws, resolver as never, { policies })).verified).toBe(true);
    const [header, payload, signature] = jws.split(".");
    const text = Buffer.from(String(payload), "base64url").toString().replace("Fractions badge", "Algebra badge");
    const changed = `${header}.${Buffer.from(text).toString("base64url")}.${signature}`;
    expect(changed).not.toBe(jws);
    await expect(jwtVerify(changed, resolver as never, { policies })).rejects.toThrow();
  });

  it("signs the JWT with the claim vc of Data Model 1.1 that we verify, bound to the issuer", async () => {
    const jwt = await createVerifiableCredentialJwt(
      {
        sub: "did:example:learner",
        nbf: Date.UTC(2026, 9, 1) / 1000,
        vc: {
          "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.2.json",
          ],
          id: "https://example.edu/credentials/1",
          type: ["VerifiableCredential", "OpenBadgeCredential"],
          name: "Fractions badge",
          issuer: { id: OURS.did, type: ["Profile"], name: "Example University" },
          issuanceDate: "2026-10-01T00:00:00Z",
          credentialSubject: {
            id: "did:example:learner",
            type: ["AchievementSubject"],
            achievement: {
              id: "https://example.edu/achievements/1",
              type: ["Achievement"],
              name: "Fractions",
              description: "Understands fractions as numbers.",
              criteria: { narrative: "Pass the final assessment." },
            },
          },
        },
      },
      await issuer(),
      { header: { kid: OURS.method } },
    );
    const result = await verifyCredential(jwt, options);
    expect(result.checks.filter(({ outcome }) => outcome === "failed")).toStrictEqual([]);
    expect(result.verified).toBe(true);
    expect(result.checks.find(({ check }) => check === "issuer")?.outcome).toBe("passed");
    const [header, payload, signature] = jwt.split(".");
    const text = Buffer.from(String(payload), "base64url").toString().replace("Fractions badge", "Algebra badge");
    const changed = `${header}.${Buffer.from(text).toString("base64url")}.${signature}`;
    expect(changed).not.toBe(jwt);
    expect((await verifyCredential(changed, options)).verified).toBe(false);
  });
});
