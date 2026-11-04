import { DataIntegrityProof as DigitalBazaarProof } from "@digitalbazaar/data-integrity";
import { createVerifyCryptosuite } from "@digitalbazaar/ecdsa-sd-2023-cryptosuite";
import { cryptosuite as eddsaRdfc2022 } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import * as vc from "@digitalbazaar/vc";
import { DataIntegrityProof } from "@interop/data-integrity-proof";
import { ecdsaRdfc2019 } from "@interop/ecdsa-signature";
import { Ed25519Signature2020 } from "@interop/ed25519-signature";
import jsigs from "@interop/jsonld-signatures";
import { verifyCredential as interopVerify } from "@interop/verifier-core";
import type { IssuableCredential } from "@interopkit/achievement-credentials";
import { addProof, deriveDisclosure, verifyProof } from "@interopkit/achievement-credentials/data-integrity";
import { createKeyResolver } from "@interopkit/achievement-credentials/keys";
import { expect, test } from "vitest";
import { clock, contexts, credentialOf, issuerOf, NOW, referenceLoader } from "./bench-fixtures.js";
import { alternate, expectRatioWithin } from "./budgets.js";
import { KEYS } from "./key-fixtures.js";

const keys = createKeyResolver({ clock });
const options = { keys, clock, contexts };
/** What `addProof` takes: it signs with the signer and does not resolve keys. */
const signingOptions = { clock, contexts };
const timeService = { dateNowMs: () => NOW, performanceNowMs: () => 0 };
const ED25519_2020_CONTEXT = "https://w3id.org/security/suites/ed25519-2020/v1";

/** Signs a credential with a suite of the Interop Alliance, for the proofs that `addProof` does not write. */
async function signWith(credential: object, suite: unknown): Promise<IssuableCredential> {
  return (await jsigs.sign(structuredClone(credential), {
    suite,
    purpose: new jsigs.purposes.AssertionProofPurpose(),
    documentLoader: referenceLoader,
  } as never)) as IssuableCredential;
}

/** The signer of a suite of the Interop Alliance over a test signer. */
const librarySigner = (issuer: ReturnType<typeof issuerOf>, algorithm: string) =>
  ({ id: issuer.method, algorithm, sign: ({ data }: { data: Uint8Array }) => issuer.signer.sign(data) }) as never;

test("signs and verifies eddsa-rdfc-2022 as fast as Digital Bazaar's vc", async ({ annotate, bench }) => {
  const issuer = issuerOf(KEYS.ed25519);
  const credential = credentialOf(issuer.did);
  const signed = await addProof(credential, issuer.signer, signingOptions);
  const suite = new DigitalBazaarProof({
    cryptosuite: eddsaRdfc2022,
    date: new Date(NOW),
    signer: {
      id: issuer.method,
      algorithm: "Ed25519",
      sign: ({ data }: { data: Uint8Array }) => issuer.signer.sign(data),
    },
  });
  const theirsSign = () =>
    vc.issue({ credential: structuredClone(credential), suite, documentLoader: referenceLoader });
  const verifier = new DigitalBazaarProof({ cryptosuite: eddsaRdfc2022 });
  const theirsVerify = () =>
    vc.verifyCredential({ credential: structuredClone(signed), suite: verifier, documentLoader: referenceLoader });
  expect((await verifyProof(signed, options)).valid).toBe(true);
  expect((await theirsVerify()).verified).toBe(true);
  expect((await verifyProof((await theirsSign()) as IssuableCredential, options)).valid).toBe(true);

  const signing = await alternate(bench, "addProof", () => addProof(credential, issuer.signer, signingOptions), {
    name: "Digital Bazaar vc.issue",
    run: theirsSign,
  });
  await expectRatioWithin(annotate, "addProof", "Digital Bazaar's vc.issue", signing);
  const verifying = await alternate(bench, "verifyProof of eddsa-rdfc-2022", () => verifyProof(signed, options), {
    name: "Digital Bazaar vc.verifyCredential",
    run: theirsVerify,
  });
  await expectRatioWithin(annotate, "verifyProofEddsa", "Digital Bazaar's vc.verifyCredential", verifying);
});

test("verifies ecdsa-rdfc-2019 and Ed25519Signature2020 as fast as the verifier of the Interop Alliance", async ({
  annotate,
  bench,
}) => {
  const p256 = issuerOf(KEYS.es256);
  const ecdsa = await signWith(
    credentialOf(p256.did),
    new DataIntegrityProof({ cryptosuite: ecdsaRdfc2019, date: NOW, signer: librarySigner(p256, "P-256") }),
  );
  const ed25519 = issuerOf(KEYS.ed25519);
  const plain = credentialOf(ed25519.did);
  const legacy = await signWith(
    { ...plain, "@context": [...plain["@context"], ED25519_2020_CONTEXT] },
    new Ed25519Signature2020({ date: NOW, signer: librarySigner(ed25519, "Ed25519") } as never),
  );
  const theirs = (credential: IssuableCredential) => () =>
    interopVerify({ credential: structuredClone(credential), documentLoader: referenceLoader, timeService } as never);
  for (const credential of [ecdsa, legacy]) {
    expect((await verifyProof(credential, { ...options, legacyProofs: true })).valid).toBe(true);
    expect((await theirs(credential)()).verified).toBe(true);
  }

  const ecdsaSides = await alternate(bench, "verifyProof of ecdsa-rdfc-2019", () => verifyProof(ecdsa, options), {
    name: "@interop/verifier-core of ecdsa-rdfc-2019",
    run: theirs(ecdsa),
  });
  await expectRatioWithin(annotate, "verifyProofEcdsa", "@interop/verifier-core", ecdsaSides);
  const legacySides = await alternate(
    bench,
    "verifyProof of Ed25519Signature2020",
    () => verifyProof(legacy, { ...options, legacyProofs: true }),
    { name: "@interop/verifier-core of Ed25519Signature2020", run: theirs(legacy) },
  );
  await expectRatioWithin(annotate, "verifyProofLegacy", "@interop/verifier-core", legacySides);
});

test("verifies an ecdsa-sd-2023 disclosure as fast as Digital Bazaar's vc with its suite", async ({
  annotate,
  bench,
}) => {
  const issuer = issuerOf(KEYS.es256);
  const base = await addProof(credentialOf(issuer.did), issuer.signer, {
    ...signingOptions,
    cryptosuite: "ecdsa-sd-2023",
  });
  const disclosure = await deriveDisclosure(base, {
    selectivePointers: ["/credentialSubject/achievement/name"],
    contexts,
  });
  const suite = new DigitalBazaarProof({ cryptosuite: createVerifyCryptosuite() });
  const theirs = () =>
    vc.verifyCredential({ credential: structuredClone(disclosure), suite, documentLoader: referenceLoader });
  expect((await verifyProof(disclosure, options)).valid).toBe(true);
  expect((await theirs()).verified).toBe(true);

  const sides = await alternate(bench, "verifyProof of ecdsa-sd-2023", () => verifyProof(disclosure, options), {
    name: "Digital Bazaar vc with ecdsa-sd-2023",
    run: theirs,
  });
  await expectRatioWithin(annotate, "verifyProofSelective", "Digital Bazaar's vc with ecdsa-sd-2023", sides);
});
