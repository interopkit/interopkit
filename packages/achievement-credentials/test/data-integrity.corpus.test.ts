import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadList, schemaDirectory } from "../../../scripts/schemas.js";
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
import { clockAt, KEYS, signerOf, type TestKey } from "./key-fixtures.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const FILES = new Map(loadList(ROOT).map(({ url, file }) => [url, file]));

/** The contexts as the downloaded files hold them. */
const DOCUMENTS = new Map(
  [...KNOWN_CONTEXTS.keys()].map((url) => {
    const file = FILES.get(url);
    if (file === undefined) throw new Error(`${url} is not in the list of downloads.`);
    return [url, JSON.parse(readFileSync(resolve(schemaDirectory(ROOT), file), "utf8"))] as const;
  }),
);

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
