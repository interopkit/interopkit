import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import * as EcdsaMultikey from "@digitalbazaar/ecdsa-multikey";
import {
  createDiscloseCryptosuite,
  createSignCryptosuite,
  createVerifyCryptosuite,
} from "@digitalbazaar/ecdsa-sd-2023-cryptosuite";
import type { Signer } from "@interopkit/core";
import jsigs from "jsonld-signatures";
import type { JsonDocument } from "../src/index.js";
import { downloadedContexts } from "./downloads.js";
import { jwkOf } from "./multikey.js";

const CONTROLLER = "https://example.test/issuers/1";

/** The issuer of the counterparty tests: a key pair of Digital Bazaar's multikey, which both suites sign and verify with. */
export interface SharedIssuer {
  /** Our signer over the same private key. */
  readonly signer: Signer;
  /** The key as the JWK that our verifier takes. */
  readonly publicKeyJwk: JsonWebKey;
  /** Digital Bazaar's signer. */
  readonly keyPair: { signer(): unknown };
  /** The loader of Digital Bazaar's stack, with the contexts and the verification method. */
  readonly documentLoader: (url: string) => Promise<unknown>;
}

/** Makes an issuer whose key both suites use. The contexts are the downloaded ones, which `pnpm schemas` pins. */
export async function createSharedIssuer(): Promise<SharedIssuer> {
  const id = `${CONTROLLER}#key-1`;
  const keyPair = await EcdsaMultikey.generate({ curve: "P-256", id, controller: CONTROLLER });
  const contexts = downloadedContexts();
  const method = await keyPair.export({ publicKey: true, includeContext: true });
  const documentLoader = async (url: string) => {
    const context = contexts.get(url);
    if (context !== undefined) return { contextUrl: null, documentUrl: url, document: structuredClone(context) };
    if (url === id) return { contextUrl: null, documentUrl: url, document: method };
    throw new Error(`The test serves no document for ${url}.`);
  };
  const dbSigner = keyPair.signer();
  return {
    keyPair,
    documentLoader,
    publicKeyJwk: jwkOf(keyPair.publicKeyMultibase),
    signer: { algorithm: "ES256", keyId: id, sign: async (data) => dbSigner.sign({ data }) },
  };
}

/** Signs a document with Digital Bazaar's suite, which writes no `created` for a date of `null`. */
export async function dbSign(
  document: JsonDocument,
  issuer: SharedIssuer,
  options: { readonly mandatoryPointers: readonly string[]; readonly created: string | null },
): Promise<JsonDocument> {
  const suite = new DataIntegrityProof({
    signer: issuer.keyPair.signer(),
    date: options.created,
    cryptosuite: createSignCryptosuite({ mandatoryPointers: [...options.mandatoryPointers] }),
  });
  return jsigs.sign(structuredClone(document), {
    suite,
    purpose: new jsigs.purposes.AssertionProofPurpose(),
    documentLoader: issuer.documentLoader,
  });
}

/** Derives a disclosure with Digital Bazaar's suite. */
export async function dbDerive(
  document: JsonDocument,
  issuer: SharedIssuer,
  selectivePointers: readonly string[],
): Promise<JsonDocument> {
  const suite = new DataIntegrityProof({
    cryptosuite: createDiscloseCryptosuite({ selectivePointers: [...selectivePointers] }),
  });
  return jsigs.derive(structuredClone(document), {
    suite,
    purpose: new jsigs.purposes.AssertionProofPurpose(),
    documentLoader: issuer.documentLoader,
  });
}

/** Verifies a disclosure with Digital Bazaar's suite. */
export async function dbVerify(document: JsonDocument, issuer: SharedIssuer): Promise<boolean> {
  const { proof, ...unsecured } = document;
  const suite = new DataIntegrityProof({ cryptosuite: createVerifyCryptosuite() });
  const result = await suite.verifyProof({ proof, document: unsecured, documentLoader: issuer.documentLoader });
  return result.verified === true;
}
