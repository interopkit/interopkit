import { DidKeyDriver } from "@interop/did-method-key";
import { DidWebResolver } from "@interop/did-web-resolver";
import { from as ecdsaFrom } from "@interop/ecdsa-multikey";
import { Ed25519VerificationKey } from "@interop/ed25519-verification-key";
import { InteropkitError } from "@interopkit/core";
import { isRecord } from "@interopkit/core/checks";
import { type DocumentSettings, fetchDocument } from "./documents.js";
import { ECDSA_HEADERS } from "./multibase.js";

/** A logger that says nothing: the libraries log through `console` unless they are given one, and a library of ours never does. */
const SILENT_LOGGER = { info() {}, error() {} };

/** Resolves a DID of one method to its DID document. */
export type DidResolver = (did: string) => Promise<Readonly<Record<string, unknown>> | undefined>;

/**
 * Makes the resolver of `did:key`: it reads the document from the DID and makes no request.
 *
 * @remarks
 * Ed25519, P-256 and P-384 keys resolve, the keys that the algorithms of the verification use. The driver builds no key
 * agreement key.
 */
export function didKeyResolver(): DidResolver {
  const driver = new DidKeyDriver();
  driver.use({ keyPairClass: Ed25519VerificationKey });
  for (const header of ECDSA_HEADERS) driver.use({ multibaseMultikeyHeader: header, fromMultibase: ecdsaFrom });
  return async (did) => {
    try {
      const document: unknown = await driver.get({ did });
      return isRecord(document) ? document : undefined;
    } catch {
      // A DID with a key of another type, or a value that is no key.
      return undefined;
    }
  };
}

/**
 * Makes the resolver of `did:web`: it derives the address of the document from the DID and fetches it through the host's
 * `fetch`, over HTTPS, without redirects, within the time and size limits.
 *
 * @remarks
 * The library checks that the document names the DID. A DID that has no document, or whose document is not a DID document,
 * does not resolve; a failed fetch is a `ServiceError`, which the caller sees.
 */
export function didWebResolver(settings: DocumentSettings): DidResolver {
  const resolver = new DidWebResolver({
    logger: SILENT_LOGGER,
    fetchDocument: ({ url }: { readonly url: string }) => fetchDocument(settings, url),
  });
  return async (did) => {
    try {
      const document: unknown = await resolver.get({ did });
      return isRecord(document) ? document : undefined;
    } catch (error) {
      // A service that failed, and a port that broke its contract, are not "no document".
      if (error instanceof InteropkitError) throw error;
      return undefined;
    }
  };
}
