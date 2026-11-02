/**
 * What the benchmarks share: the contexts that `pnpm schemas` downloads, a fixed clock, issuers that are the `did:key` of a test
 * key, the credential that they award, and the loader of documents that the reference libraries read the same contexts and
 * keys through.
 */
import { DidKeyDriver } from "@interop/did-method-key";
import { from as ecdsaFrom } from "@interop/ecdsa-multikey";
import { Ed25519VerificationKey } from "@interop/ed25519-verification-key";
import { buildAchievementCredential, buildClrCredential } from "@interopkit/achievement-credentials";
import { createContextLoader } from "@interopkit/achievement-credentials/data-integrity";
import { downloadedContexts } from "./downloaded-contexts.js";
import { clockAt, signerOf, type TestKey } from "./key-fixtures.js";

/** The contexts by address, as `pnpm schemas` pins them. */
const CONTEXTS = downloadedContexts();
/** The time of every benchmark, a month after the credentials are valid from. */
export const NOW = Date.UTC(2026, 10, 1);
export const clock = clockAt(NOW);
/** The loader of contexts of the package, over the downloaded contexts. */
export const contexts = createContextLoader({ documents: CONTEXTS });

/** An issuer that is the `did:key` of a key, with the method of the key and a signer that names it. */
export function issuerOf(key: TestKey) {
  const did = `did:key:${key.multikey}`;
  const method = `${did}#${key.multikey}`;
  return { did, method, signer: signerOf(key, method) };
}

/** The achievement credential that an issuer awards, with an achievement of four properties. */
export function credentialOf(did: string) {
  return buildAchievementCredential({
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
}

/** A CLR that a university issues, which holds `count` achievement credentials as objects, each with its evidence. */
export function clrOf(count: number) {
  const issuer = "https://example.edu/issuers/1";
  const credential = credentialOf(issuer);
  return buildClrCredential({
    id: "https://example.edu/clrs/1",
    issuer: { id: issuer, type: ["Profile"], name: "Example University" },
    validFrom: "2026-10-01T00:00:00Z",
    name: "Record of the year",
    subject: { id: "did:example:learner" },
    credentials: Array.from({ length: count }, (_, index) => ({
      ...credential,
      id: `https://example.edu/credentials/${index + 1}`,
      evidence: [{ id: `https://example.edu/evidence/${index + 1}`, type: ["Evidence"], name: "Final project" }],
    })),
  });
}

/** The `did:key` driver of the Interop Alliance for Ed25519 and P-256 keys, which the references resolve keys with. */
const didKeyDriver = new DidKeyDriver();
didKeyDriver.use({ keyPairClass: Ed25519VerificationKey });
didKeyDriver.use({ multibaseMultikeyHeader: "zDna", fromMultibase: ecdsaFrom });

/** The loader of documents of the reference libraries: the downloaded contexts, and the documents of `did:key`. */
export async function referenceLoader(url: string) {
  const context = CONTEXTS.get(url);
  if (context !== undefined) return { contextUrl: null, documentUrl: url, document: structuredClone(context) };
  if (url.startsWith("did:key:")) {
    return { contextUrl: null, documentUrl: url, document: await didKeyDriver.get({ url }) };
  }
  throw new Error(`The benchmark serves no document for ${url}.`);
}
