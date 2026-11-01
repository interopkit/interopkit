import { describe, expect, it } from "vitest";
import { addBaseProof, deriveProof, selectiveDisclosureSuite } from "../src/index.js";
import { createSharedIssuer, dbDerive, dbSign, dbVerify, type SharedIssuer } from "./digital-bazaar.js";
import { CREATED, MANDATORY_POINTERS, SELECTIVE_POINTERS } from "./documents.js";
import { downloadedContexts } from "./downloads.js";
import { vcCredential } from "./vc-credential.js";

const CONTEXTS = downloadedContexts();

const contexts = async (url: string) => {
  const context = CONTEXTS.get(url);
  if (context === undefined) throw new Error(`The test serves no context for ${url}.`);
  return structuredClone(context);
};

type Party = "we" | "Digital Bazaar";
const PARTIES: readonly Party[] = ["we", "Digital Bazaar"];
const COMBINATIONS = PARTIES.flatMap((signer) =>
  PARTIES.flatMap((deriver) => PARTIES.map((verifier) => [signer, deriver, verifier] as const)),
);

async function sign(party: Party, issuer: SharedIssuer) {
  const options = { mandatoryPointers: MANDATORY_POINTERS, created: CREATED };
  return party === "we"
    ? addBaseProof(vcCredential(), { ...options, signer: issuer.signer, contexts })
    : dbSign(vcCredential(), issuer, options);
}

async function derive(party: Party, issuer: SharedIssuer, signed: Record<string, unknown>) {
  return party === "we"
    ? deriveProof(signed, { selectivePointers: SELECTIVE_POINTERS, contexts })
    : dbDerive(signed, issuer, SELECTIVE_POINTERS);
}

async function verify(party: Party, issuer: SharedIssuer, derived: Record<string, unknown>) {
  const { proof, ...document } = derived;
  return party === "we"
    ? selectiveDisclosureSuite.verify(document, proof as Record<string, unknown>, {
        publicKeyJwk: issuer.publicKeyJwk,
        contexts,
      })
    : dbVerify(derived, issuer);
}

describe("Digital Bazaar's ecdsa-sd-2023 suite as a counterparty", () => {
  it.each(COMBINATIONS)(
    "accepts a proof that %s signed, %s derived and %s verified",
    async (signer, deriver, verifier) => {
      const issuer = await createSharedIssuer();
      const derived = await derive(deriver, issuer, await sign(signer, issuer));
      expect(await verify(verifier, issuer, derived)).toBe(true);
    },
  );

  it.each(COMBINATIONS)(
    "agrees on statements that compare a character beyond the BMP with one above it, when %s signed, %s derived and %s verified",
    async (signer, deriver, verifier) => {
      // U+FFEE and U+1F600 compare the other way round by code point and by UTF-16 code unit.
      const credential = {
        ...vcCredential(),
        credentialSubject: { type: "Person", tag: ["\uFFEEx", "\u{1F600}x"], name: "Sam Taylor" },
      };
      const issuer = await createSharedIssuer();
      const options = { mandatoryPointers: MANDATORY_POINTERS, created: CREATED };
      const signed =
        signer === "we"
          ? await addBaseProof(credential, { ...options, signer: issuer.signer, contexts })
          : await dbSign(credential, issuer, options);
      const pointers = ["/credentialSubject/tag"];
      const derived =
        deriver === "we"
          ? await deriveProof(signed, { selectivePointers: pointers, contexts })
          : await dbDerive(signed, issuer, pointers);
      expect(await verify(verifier, issuer, derived)).toBe(true);
    },
  );

  it.each(PARTIES)("both refuse a disclosure whose revealed name %s changed", async (deriver) => {
    const issuer = await createSharedIssuer();
    const derived = await derive(deriver, issuer, await sign(deriver, issuer));
    const subject = derived.credentialSubject as Record<string, unknown>;
    const forged = { ...derived, credentialSubject: { ...subject, name: "Someone Else" } };
    expect(await verify("we", issuer, forged)).toBe(false);
    expect(await verify("Digital Bazaar", issuer, forged)).toBe(false);
  });
});
