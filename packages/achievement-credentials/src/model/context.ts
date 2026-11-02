import type { JsonObject } from "@interopkit/core/checks";

/**
 * The JSON-LD contexts that credentials name: the Verifiable Credentials contexts of the two data models, the Open Badges
 * context, the CLR context and the context of Open Badges 2.0.
 *
 * @remarks
 * The Open Badges context is `context-3.0.3.json`, the current one; a credential may name any `context-3.0.x.json`.
 *
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/ | Open Badges 3.0, A.2}
 */
export const CONTEXTS = {
  /** The Verifiable Credentials Data Model 2.0. */
  credentialsV2: "https://www.w3.org/ns/credentials/v2",
  /** The Verifiable Credentials Data Model 1.1. */
  credentialsV1: "https://www.w3.org/2018/credentials/v1",
  /** Open Badges 3.0. */
  openBadges: "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
  /** CLR 2.0. */
  clr: "https://purl.imsglobal.org/spec/clr/v2p0/context-2.0.1.json",
  /** The types of the 1EdTech extensions of a credential: `1EdTechJsonSchemaValidator2019`, `1EdTechRevocationList` and `1EdTechCredentialRefresh`. */
  extensions: "https://purl.imsglobal.org/spec/ob/v3p0/extensions.json",
  /** Open Badges 2.0, which an assertion names as its only context. */
  openBadgesV2: "https://w3id.org/openbadges/v2",
} as const;

/** A context after the ones that a class requires: the address of a context, or a context that the credential holds. */
export type ContextEntry = string | JsonObject;
