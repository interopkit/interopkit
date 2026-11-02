/**
 * The terms of verification: a key that verifies a proof, the port that resolves keys, a check of a verification and the
 * result of reading a proof.
 *
 * @module
 */
import type { CallOptions } from "@interopkit/core";
import type { AnyCredential, AnyVerifiableCredential } from "./kinds.js";

/** The verification relationships of a DID document or controller document that a key can sit under (Controlled Identifiers 1.0 section 2.3). */
export const KEY_RELATIONSHIPS = [
  "assertionMethod",
  "authentication",
  "capabilityInvocation",
  "capabilityDelegation",
] as const;

/** A verification relationship: what a controller allows a key to do. */
export type KeyRelationship = (typeof KEY_RELATIONSHIPS)[number];

/** A public key that can verify a proof, with what is known of who controls it and what it is allowed to do. */
export interface VerificationKey {
  /** The identifier of the key: the URL of the verification method, or `kid`. */
  readonly id: string;
  /**
   * The entity that controls the key. Absent for a bare JWK at a `kid` and for an embedded `jwk`, which bind by thumbprint
   * alone.
   *
   * @defaultValue none
   */
  readonly controller?: string;
  /**
   * The `iss` member of the JWK Set entry that held the key. `verifyIssuerKey` refuses a key whose `iss` is not the issuer,
   * whatever resolver supplied it, so that the issuers of a shared platform stay apart.
   *
   * @defaultValue none
   */
  readonly iss?: string;
  /** The public key as a JWK that holds public members only. */
  readonly publicKeyJwk: JsonWebKey;
  /** The verification relationships under which the document that holds the key lists it. */
  readonly relationships: readonly KeyRelationship[];
}

/** Resolves the keys that verify proofs and the keys that an issuer publishes. */
export interface KeyResolver {
  /**
   * Returns the key that a verification method or a `kid` names.
   *
   * @param verificationMethod - The URL of a verification method, a DID URL, or the URL of a key.
   * @param options - The `signal` that ends the caller's wait.
   * @returns The key, or `undefined` when nothing names it or no configured method resolves it.
   */
  resolve(verificationMethod: string, options?: CallOptions): Promise<VerificationKey | undefined>;
  /**
   * Returns what an issuer publishes: the keys of its identifier document and, for an HTTPS issuer, of its JWK Set, each
   * member's `iss` kept in `VerificationKey.iss`.
   *
   * @param issuer - The `id` of the issuer.
   * @param options - The `signal` that ends the caller's wait.
   * @returns The keys, none when the issuer publishes none that this resolver can read.
   */
  issuerKeys(issuer: string, options?: CallOptions): Promise<readonly VerificationKey[]>;
}

/** Returns the JSON-LD context behind a URL, or rejects. The processors of JSON-LD read no context from anywhere else. */
export type ContextLoader = (url: string, options?: CallOptions) => Promise<unknown>;

/** What a Data Integrity suite is given besides the document and the proof. */
export interface SuiteVerifyOptions extends CallOptions {
  /** The public key that verifies the proof, which the glue has resolved and bound to the issuer. */
  readonly publicKeyJwk: JsonWebKey;
  /** The loader of the contexts of the document: the only way a suite reads a context. */
  readonly contexts: ContextLoader;
  /**
   * The most bytes of the document and its proof as JSON. The glue has checked it, so a suite that counts them does not refuse a
   * document that the glue let through.
   *
   * @defaultValue none: the suite's own
   */
  readonly maxBytes?: number;
  /**
   * The most tokens of JSON in the document and its proof, which bound the work of a JSON-LD processor. The glue has checked
   * it, as for `maxBytes`.
   *
   * @defaultValue none: the suite's own
   */
  readonly maxTokens?: number;
}

/** A Data Integrity cryptosuite. The glue resolves and binds the key first, so a suite only checks the proof. */
export interface DataIntegritySuite {
  /** The `cryptosuite` of the proofs that it verifies, such as `eddsa-rdfc-2022`. */
  readonly cryptosuite: string;
  /**
   * Checks a proof.
   *
   * @remarks
   * A suite answers `false` for a proof that does not verify. It rejects with a `DataError` for a document that it refuses
   * for a reason the caller should read, such as a limit: the glue reports the message as the reason of the `proof` check. A
   * `ServiceError` of a context and the abort of the signal reach the caller as they are.
   *
   * @param document - The credential as the proof secures it: without its proofs, or, for a proof that names a
   * `previousProof`, with the proofs that it names as its `proof` (Data Integrity 4.5).
   * @param proof - The proof to check.
   * @param options - The public key that verifies it, the loader of the contexts of the document and the limits.
   * @returns Whether the proof is valid for the document under the key.
   */
  verify(
    document: Readonly<Record<string, unknown>>,
    proof: Readonly<Record<string, unknown>>,
    options: SuiteVerifyOptions,
  ): Promise<boolean>;
}

/** A term of a credential that JSON-LD processing in safe mode would drop or cannot expand. */
export interface JsonLdIssue {
  /** Where the term is, as a JSON Pointer; the first place that the name occurs. */
  readonly path: string;
  /** The property or the value that the processor reports. */
  readonly term: string;
  /** What the processor says of it. */
  readonly message: string;
}

/** The steps of a verification, in the order of Open Badges 9. */
export const VERIFICATION_CHECKS = [
  "format",
  "schema",
  "proof",
  "issuer",
  "refresh",
  "status",
  "validity",
  "recipient",
] as const;

/** A step of a verification. */
export type VerificationCheckName = (typeof VERIFICATION_CHECKS)[number];

/** How a step ended. */
export const CHECK_OUTCOMES = ["passed", "failed", "unavailable", "skipped"] as const;

/** The outcome of a step: it passed, it failed, what it needs could not be read, or it did not run. */
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** One step of a verification and how it ended. */
export interface VerificationCheck {
  /** The step. */
  readonly check: VerificationCheckName;
  /** How it ended. */
  readonly outcome: CheckOutcome;
  /** A sentence that says why, and for a status the code of the Bitstring Status List algorithm. */
  readonly detail: string;
}

/**
 * What reading a proof gives: the credential that a valid proof secures with the key that verified it, or the reason that the
 * proof is not valid.
 *
 * @remarks
 * `bound` says whether the key belongs to the issuer of the credential (`verifyIssuerKey`). It is true whenever the binding
 * was checked and passed. It is false only when the reader was told to accept unbound keys, and then the binding was not
 * looked up.
 */
export type ProofResult =
  | {
      /** The proof is valid. */
      readonly valid: true;
      /** The credential that the proof secures. */
      readonly credential: AnyVerifiableCredential;
      /** The key that verified the proof. */
      readonly key: VerificationKey;
      /** Whether the key is bound to the issuer of the credential. */
      readonly bound: boolean;
    }
  | {
      /** The proof is not valid. */
      readonly valid: false;
      /** A sentence that says what is wrong with the proof. */
      readonly reason: string;
    };

/** What a verification found of a credential: whether it is verified, what was checked, and what it holds. */
export interface VerificationResult {
  /** Whether every check passed or did not apply, and so did every endorsement and every credential that a CLR holds. */
  readonly verified: boolean;
  /** The credential that the proof secures, set when the proof is valid and the issuer check did not fail. */
  readonly credential?: AnyCredential;
  /** Every check of the verification, in the order of Open Badges 9. */
  readonly checks: readonly VerificationCheck[];
  /** The results for the endorsements of the credential, of its issuer and of its achievements. */
  readonly endorsements: readonly VerificationResult[];
  /** The results for the credentials that a CLR holds. */
  readonly nested: readonly VerificationResult[];
}
