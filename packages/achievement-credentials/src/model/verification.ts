/**
 * The terms of verification: a key that verifies a proof, the port that resolves keys, a check of a verification and the
 * result of reading a proof.
 *
 * @module
 */
import type { CallOptions } from "@interopkit/core";
import type { AnyCredential } from "./kinds.js";

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
      readonly credential: AnyCredential;
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
