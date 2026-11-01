/**
 * Contexts for the tests that run offline: small ones that define what a test needs. The real contexts are read in the tests
 * that need a download.
 */
import type { CallOptions } from "@interopkit/core";

/** The address of the context of Data Integrity 2, which a proof adds to the credential it secures. */
const DATA_INTEGRITY = "https://w3id.org/security/data-integrity/v2";

/** A context that defines two terms and nothing else, so that any other term is undefined. */
export const CLOSED = "https://example.test/contexts/closed/v1";

const OPEN_DOCUMENT = {
  "@context": { "@version": 1.1, "@vocab": "https://example.test/vocab#", id: "@id", type: "@type" },
};

const CLOSED_DOCUMENT = {
  "@context": {
    "@version": 1.1,
    id: "@id",
    type: "@type",
    name: "https://example.test/vocab#name",
    Thing: "https://example.test/vocab#Thing",
  },
};

const SECURITY = "https://w3id.org/security#";
const XSD_DATE_TIME = "http://www.w3.org/2001/XMLSchema#dateTime";

/** The terms of a proof, as the context of Data Integrity 2 defines them. */
const DATA_INTEGRITY_DOCUMENT = {
  "@context": {
    "@version": 1.1,
    "@protected": true,
    id: "@id",
    type: "@type",
    DataIntegrityProof: {
      "@id": `${SECURITY}DataIntegrityProof`,
      "@context": {
        "@protected": true,
        id: "@id",
        type: "@type",
        challenge: `${SECURITY}challenge`,
        created: { "@id": "http://purl.org/dc/terms/created", "@type": XSD_DATE_TIME },
        cryptosuite: { "@id": `${SECURITY}cryptosuite`, "@type": `${SECURITY}cryptosuiteString` },
        domain: `${SECURITY}domain`,
        expires: { "@id": `${SECURITY}expiration`, "@type": XSD_DATE_TIME },
        nonce: `${SECURITY}nonce`,
        previousProof: { "@id": `${SECURITY}previousProof`, "@type": "@id" },
        proofPurpose: {
          "@id": `${SECURITY}proofPurpose`,
          "@type": "@vocab",
          "@context": {
            "@protected": true,
            id: "@id",
            type: "@type",
            assertionMethod: { "@id": `${SECURITY}assertionMethod`, "@type": "@id", "@container": "@set" },
            authentication: { "@id": `${SECURITY}authenticationMethod`, "@type": "@id", "@container": "@set" },
          },
        },
        proofValue: { "@id": `${SECURITY}proofValue`, "@type": `${SECURITY}multibase` },
        verificationMethod: { "@id": `${SECURITY}verificationMethod`, "@type": "@id" },
      },
    },
  },
};

/**
 * A loader that serves the context of Data Integrity 2 and the closed context, and an open context for every other address,
 * and records each address that it is asked for. The open context maps every term into one vocabulary, as the contexts of
 * credentials do for what they do not define.
 */
export function memoryContexts(): {
  readonly load: (url: string, options?: CallOptions) => Promise<unknown>;
  readonly requested: string[];
} {
  const requested: string[] = [];
  return {
    requested,
    async load(url) {
      requested.push(url);
      if (url === DATA_INTEGRITY) return structuredClone(DATA_INTEGRITY_DOCUMENT);
      return structuredClone(url === CLOSED ? CLOSED_DOCUMENT : OPEN_DOCUMENT);
    },
  };
}
