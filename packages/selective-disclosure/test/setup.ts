import { addBaseProof, type BaseProofOptions, deriveProof, type JsonDocument } from "../src/index.js";
import { memoryContexts } from "./contexts.js";
import { CREATED, MANDATORY_POINTERS, SELECTIVE_POINTERS, sampleCredential } from "./documents.js";
import { createIssuer, type Issuer } from "./keys.js";

/** An issuer, a loader of contexts that records what it is asked for, and a credential with its base proof. */
export interface Signed {
  readonly issuer: Issuer;
  readonly contexts: ReturnType<typeof memoryContexts>;
  readonly base: JsonDocument;
}

/** Signs the sample credential with a new issuer. */
export async function signedCredential(overrides: Partial<BaseProofOptions> = {}): Promise<Signed> {
  const issuer = await createIssuer();
  const contexts = memoryContexts();
  const base = await addBaseProof(sampleCredential(), {
    signer: issuer.signer,
    mandatoryPointers: MANDATORY_POINTERS,
    contexts: contexts.load,
    created: CREATED,
    ...overrides,
  });
  return { issuer, contexts, base };
}

/** A disclosure of the sample credential: the document, its proof, and what is needed to verify it. */
export interface Disclosure extends Signed {
  readonly derived: JsonDocument;
  readonly document: JsonDocument;
  readonly proof: Record<string, unknown>;
}

/** Signs the sample credential and derives the disclosure that the tests share. */
export async function disclosure(pointers: readonly string[] = SELECTIVE_POINTERS): Promise<Disclosure> {
  const signed = await signedCredential();
  const derived = await deriveProof(signed.base, { selectivePointers: pointers, contexts: signed.contexts.load });
  const { proof, ...document } = derived;
  return { ...signed, derived, document, proof: proof as Record<string, unknown> };
}
