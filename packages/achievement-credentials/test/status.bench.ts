import { DataIntegrityProof } from "@interop/data-integrity-proof";
import { eddsaRdfc2022 } from "@interop/ed25519-signature";
import jsigs from "@interop/jsonld-signatures";
import { checkStatus, createCredential, createList } from "@interop/vc-bitstring-status-list";
import type { IssuableCredential } from "@interopkit/achievement-credentials";
import { createKeyResolver } from "@interopkit/achievement-credentials/keys";
import {
  createStatusList,
  issueStatusListCredential,
  setCredentialStatus,
  verifyCredentialStatus,
} from "@interopkit/achievement-credentials/status";
import type { Fetch } from "@interopkit/core";
import { expect, test } from "vitest";
import { clock, contexts, credentialOf, issuerOf, referenceLoader } from "./bench-fixtures.js";
import { alternate, expectRatioWithin } from "./budgets.js";
import { KEYS } from "./key-fixtures.js";

const LIST_URL = "https://example.edu/status/1";
/** The entries of the list: the least that Bitstring Status List allows, which hides one credential among 131,072. */
const LENGTH = 131_072;
/** The entries that are set: one revoked credential in a hundred. */
const REVOKED = Array.from({ length: LENGTH / 100 }, (_, index) => index * 100 + 7);
const INDEX = 94_567;

const issuer = issuerOf(KEYS.ed25519);
const input = { id: LIST_URL, issuer: issuer.did, validFrom: "2026-10-01T00:00:00Z", purpose: "revocation" as const };
/** The signer of the suite of the Interop Alliance over the test signer. */
const librarySigner = {
  id: issuer.method,
  algorithm: "Ed25519",
  sign: ({ data }: { data: Uint8Array }) => issuer.signer.sign(data),
};

/** The credential with an entry in the list. */
const credential = {
  ...credentialOf(issuer.did),
  credentialStatus: {
    id: `${LIST_URL}#${INDEX}`,
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: String(INDEX),
    statusListCredential: LIST_URL,
  },
} as IssuableCredential;

/** Signs the list of the Interop Alliance as the issuer, with its own suite. */
async function theirsIssue() {
  const list = await createList({ length: LENGTH });
  for (const index of REVOKED) list.setStatus(index, true);
  const unsigned = await createCredential({ id: LIST_URL, list, statusPurpose: "revocation" });
  return await jsigs.sign({ ...unsigned, issuer: issuer.did, validFrom: input.validFrom }, {
    suite: new DataIntegrityProof({ cryptosuite: eddsaRdfc2022, signer: librarySigner as never }),
    purpose: new jsigs.purposes.AssertionProofPurpose(),
    documentLoader: referenceLoader,
  } as never);
}

test("issues and checks a status list with a Data Integrity proof as fast as the library of the Interop Alliance", async ({
  annotate,
  bench,
}) => {
  let list = createStatusList({ length: LENGTH });
  for (const index of REVOKED) list = setCredentialStatus(list, index, true);
  const ourIssue = () =>
    issueStatusListCredential({ ...input, list }, issuer.signer, { proof: "data-integrity", contexts, clock });
  const signed = await ourIssue();
  const text = JSON.stringify(signed);
  const fetch: Fetch = async () => new Response(text, { headers: { "content-type": "application/vc+ld+json" } });
  const keys = createKeyResolver({ clock });
  const ours = () => verifyCredentialStatus(credential, { fetch, keys, clock, contexts });
  const loader = async (url: string) =>
    url === LIST_URL ? { contextUrl: null, documentUrl: url, document: JSON.parse(text) } : referenceLoader(url);
  const suite = new DataIntegrityProof({ cryptosuite: eddsaRdfc2022 });
  const theirs = () =>
    checkStatus({ credential, documentLoader: loader, suite, verifyBitstringStatusListCredential: true });
  expect(await ours()).toMatchObject({ outcome: "passed" });
  expect(await theirs()).toMatchObject({ verified: true, results: [{ verified: true, status: false }] });
  expect(await verifyCredentialStatus(credential, { fetch, keys, clock, contexts })).toMatchObject({
    outcome: "passed",
  });

  const issuing = await alternate(bench, "issueStatusListCredential", ourIssue, {
    name: "@interop/vc-bitstring-status-list with jsigs.sign",
    run: theirsIssue,
  });
  await expectRatioWithin(annotate, "issueStatusList", "@interop/vc-bitstring-status-list", issuing);
  const checking = await alternate(bench, "verifyCredentialStatus", ours, {
    name: "@interop/vc-bitstring-status-list checkStatus",
    run: theirs,
  });
  await expectRatioWithin(annotate, "verifyCredentialStatus", "@interop/vc-bitstring-status-list", checking);
});
