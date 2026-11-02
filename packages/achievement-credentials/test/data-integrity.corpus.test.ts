import { describe, expect, it } from "vitest";
import {
  addProof,
  createContextLoader,
  deriveDisclosure,
  KNOWN_CONTEXTS,
  validateJsonLd,
  verifyProof,
} from "../src/data-integrity/index.js";
import { contextHash } from "../src/data-integrity/internal.js";
import type { IssuableCredential } from "../src/index.js";
import { buildAchievementCredential, buildClrCredential, buildEndorsementCredential } from "../src/index.js";
import { createKeyResolver } from "../src/keys/index.js";
import { downloadedContexts, downloadedFile } from "./downloaded-contexts.js";
import { clockAt, KEYS, signerOf, type TestKey } from "./key-fixtures.js";

/** The contexts as the downloaded files hold them. */
const DOCUMENTS = downloadedContexts();

describe("the pins of the known contexts", () => {
  it.each([...KNOWN_CONTEXTS])("hold for %s", (url, pin) => {
    expect(contextHash(DOCUMENTS.get(url))).toBe(pin);
  });
});

function issuerOf(key: TestKey) {
  const did = `did:key:${key.multikey}`;
  return {
    did,
    profile: { id: did, type: ["Profile"], name: "Example University" },
    signer: signerOf(key, `${did}#${key.multikey}`),
  };
}

const NOW = Date.UTC(2025, 0, 2, 3, 4, 5);
const clock = clockAt(NOW);
const contexts = createContextLoader({ documents: DOCUMENTS });
const options = { clock, contexts };
const keys = createKeyResolver({ clock });
const read = { keys, clock, contexts };

/** The credentials that the builders write for an issuer, one of each kind. */
function builtBy(profile: ReturnType<typeof issuerOf>["profile"]): Record<string, IssuableCredential> {
  const achievement = {
    id: "https://example.edu/achievements/1",
    type: ["Achievement"] as const,
    name: "Fractions",
    description: "Understands fractions as numbers.",
    criteria: { narrative: "Pass the final assessment." },
  };
  const badge = buildAchievementCredential({
    id: "https://example.edu/credentials/1",
    issuer: profile,
    validFrom: "2025-01-01T00:00:00Z",
    name: "Fractions badge",
    description: "Awarded for the course.",
    subject: { id: "did:example:learner" },
    achievement,
  });
  return {
    badge,
    endorsement: buildEndorsementCredential({
      id: "https://example.edu/endorsements/1",
      issuer: profile,
      validFrom: "2025-01-01T00:00:00Z",
      name: "Endorsement",
      endorses: "https://example.edu/achievements/1",
    }),
    clr: buildClrCredential({
      id: "https://example.edu/clrs/1",
      issuer: profile,
      validFrom: "2025-01-01T00:00:00Z",
      name: "Transcript",
      subject: { id: "did:example:learner" },
      credentials: [badge],
    }),
  } as unknown as Record<string, IssuableCredential>;
}

describe("a credential with the real contexts", () => {
  const ed = issuerOf(KEYS.ed25519);
  const credentials = builtBy(ed.profile);

  it.each(Object.keys(credentials))("loses no term in safe mode: %s", async (name) => {
    expect(await validateJsonLd(credentials[name] as IssuableCredential, { contexts })).toStrictEqual([]);
  });

  it("is signed with eddsa-rdfc-2022 and verified, bound to the did:key issuer that holds the key", async () => {
    for (const credential of Object.values(credentials)) {
      const signed = await addProof(credential, ed.signer, options);
      expect(await verifyProof(signed, read)).toMatchObject({ valid: true, bound: true });
    }
  });

  it("is signed with ecdsa-sd-2023, derived into a disclosure and verified", async () => {
    const es = issuerOf(KEYS.es256);
    const credential = builtBy(es.profile).badge as IssuableCredential;
    const base = await addProof(credential, es.signer, { ...options, cryptosuite: "ecdsa-sd-2023" });
    expect(await verifyProof(base, read)).toMatchObject({ valid: false });
    const disclosure = await deriveDisclosure(base, { selectivePointers: ["/description"], contexts });
    expect(await verifyProof(disclosure, read)).toMatchObject({ valid: true, bound: true });
    const hidden = await deriveDisclosure(base, { selectivePointers: [], contexts });
    expect(hidden).not.toHaveProperty("description");
    expect(await verifyProof(hidden, read)).toMatchObject({ valid: true, bound: true });
  });

  it("is refused after one character of it changed", async () => {
    const signed = await addProof(credentials.badge as IssuableCredential, ed.signer, options);
    const changed = { ...signed, name: "Fractions badge." } as unknown as IssuableCredential;
    expect(await verifyProof(changed, read)).toMatchObject({ valid: false });
  });
});

/** The proof chains that the W3C suite of the Data Integrity cryptosuites posts to a verifier, signed by its authors. */
const CHAINS =
  "https://raw.githubusercontent.com/w3c-ccg/data-integrity-test-suite-assertion/8d84d182f022f02049135f7d1ad3d5d0181e5560/inputs/eddsa-rdfc-2022/";

describe("the proof chains of the W3C suite of Data Integrity", () => {
  it.each([
    ["a chain that names its previous proof by a string", "previousProofStringOk", true],
    ["a chain that names its previous proofs in a list", "previousProofArrayOk", true],
    ["a proof that names a proof by a string the credential lacks", "previousProofStringMissingFail", false],
    ["a proof that names proofs in a list the credential lacks", "previousProofArrayMissingFail", false],
    ["a proof whose previousProof is a number", "previousProofNotStringFail", false],
  ])("verify as the suite expects: %s", async (_name, file, valid) => {
    const credential = JSON.parse(downloadedFile(`${CHAINS}2.0-${file}-SimpleSigned2.json`)) as IssuableCredential;
    expect((await verifyProof(credential, read)).valid).toBe(valid);
  });
});
