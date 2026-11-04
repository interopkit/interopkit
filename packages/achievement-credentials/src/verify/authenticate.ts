import { DataError, ServiceError } from "@interopkit/core";
import { textWithinLimits } from "../json-text.js";
import { inspectJwt } from "../jwt/internal.js";
import { bindKey } from "../keys/internal.js";
import type { AnyVerifiableCredential, VerificationCheck, VerificationKey } from "../model/index.js";
import { credentialOrReason, type VerifiedKind, verifiedKindOf } from "../read/internal.js";
import type { Context } from "./context.js";
import type { Prepared } from "./input.js";
import { type Checks, checkOf } from "./result.js";

/** What a proof secures, once it is valid and its key is not another issuer's. */
export interface Authentic {
  readonly credential: AnyVerifiableCredential;
  readonly kind: VerifiedKind;
  /** The credential as it was written, which a schema judges. */
  readonly raw: unknown;
  /** What is wrong with the time claims of a JWS, which is the validity of the credential. */
  readonly timeFault: string | undefined;
}

/** What the first checks found: the checks that ran, why the rest did not, and what the proof secures. */
export interface Authenticated {
  readonly checks: Checks;
  /** The credential that the proof secures. Absent when the form, the proof or the issuer's hold on the key failed. */
  readonly authentic?: Authentic;
}

const NOT_A_CREDENTIAL = "The credential is not an AchievementCredential, an EndorsementCredential or a ClrCredential.";

/** Reads an object into the model within the limits of the input. */
function readObject(
  value: Readonly<Record<string, unknown>>,
  context: Context,
): { readonly credential: AnyVerifiableCredential } | { readonly reason: string } {
  try {
    textWithinLimits(value, context.settings.jwt, "The credential");
  } catch (error) {
    return { reason: error instanceof DataError ? error.message : "The credential is not JSON." };
  }
  const read = credentialOrReason(value, "The credential");
  return "reason" in read ? read : { credential: read.value };
}

/** Binds the key to the issuer of the credential, or says that the host chose not to. */
function issuerCheckOf(
  credential: AnyVerifiableCredential,
  key: VerificationKey,
  context: Context,
): Promise<VerificationCheck> {
  const issuer = typeof credential.issuer === "string" ? credential.issuer : credential.issuer.id;
  return bindKey(key, issuer, context.settings.jwt);
}

/** What a proof secures: the credential, as written and as read, and the key that verified the proof. */
interface Secured {
  readonly credential: AnyVerifiableCredential;
  readonly kind: VerifiedKind;
  readonly raw: unknown;
  readonly key: VerificationKey;
  readonly timeFault: string | undefined;
  /** The issuer check of the key, when the proofs were looked at with it. */
  readonly issuer?: VerificationCheck;
}

/** What the proof of a credential gave: what it secures, or the checks that say why it secures nothing. */
type ProofStep = { readonly secured: Secured } | { readonly checks: Checks };

const formatPassed = (): VerificationCheck =>
  checkOf("format", "passed", "The input holds a credential that the readers accept.");

const unknownKind = (): Checks => ({ format: checkOf("format", "failed", NOT_A_CREDENTIAL) });

/** Checks the proof of a JWS: the signature is the proof. */
async function jwsProof(jws: string, context: Context): Promise<ProofStep> {
  let inspected: Awaited<ReturnType<typeof inspectJwt>>;
  try {
    inspected = await inspectJwt(jws, context.settings.jwt);
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    const detail = `The key that verifies the JWS could not be read: ${error.message}`;
    return { checks: { format: formatPassed(), proof: checkOf("proof", "unavailable", detail) } };
  }
  if (inspected.valid) {
    const kind = verifiedKindOf(inspected.credential.type);
    return kind === undefined ? { checks: unknownKind() } : { secured: { ...inspected, kind } };
  }
  return {
    checks:
      inspected.check === "format"
        ? { format: checkOf("format", "failed", inspected.reason) }
        : { format: formatPassed(), proof: checkOf("proof", "failed", inspected.reason) },
  };
}

/** Checks the Data Integrity proofs of a credential that was read. */
async function dataIntegrityProof(
  value: Readonly<Record<string, unknown>>,
  credential: AnyVerifiableCredential,
  kind: VerifiedKind,
  context: Context,
): Promise<ProofStep> {
  const { settings } = context;
  const proof = (outcome: "failed" | "unavailable", detail: string): ProofStep => ({
    checks: { format: formatPassed(), proof: checkOf("proof", outcome, detail) },
  });
  if (value.proof === undefined) return proof("failed", "The credential has no proof.");
  if (settings.contexts === undefined) {
    return proof(
      "unavailable",
      "The credential has a Data Integrity proof, and the option contexts was not given to check it.",
    );
  }
  // Loaded when a credential with a Data Integrity proof is verified, so that a verifier of JWTs never loads JSON-LD.
  const { inspectProofs } = await import("../data-integrity/internal.js");
  const { jwt } = settings;
  try {
    // The issuer check of a proof's key is a check of its own, so that its failure is told apart from the proof's.
    const verdict = await inspectProofs(
      value,
      credential,
      {
        keys: jwt.keys,
        clock: jwt.clock,
        contexts: settings.contexts,
        clockSkewSeconds: jwt.clockSkewSeconds,
        legacyProofs: settings.legacyProofs,
        suites: settings.suites,
        maxInputBytes: jwt.maxInputBytes,
        maxDepth: jwt.maxDepth,
        maxTokens: jwt.maxTokens,
        maxJsonLdTokens: settings.maxJsonLdTokens,
        ...(jwt.signal === undefined ? {} : { signal: jwt.signal }),
      },
      (key) => issuerCheckOf(credential, key, context),
    );
    if (verdict.valid) {
      const { key, issuer } = verdict;
      return { secured: { credential, kind, raw: value, key, timeFault: undefined, issuer } };
    }
    return proof(verdict.unavailable ? "unavailable" : "failed", verdict.reason);
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    return proof("unavailable", `A key or a context of the proof could not be read: ${error.message}`);
  }
}

/**
 * Runs the first checks of a verification: the form of the input, the proof, and the key's hold on the issuer. Nothing that the
 * credential names is fetched here, so a credential whose proof fails costs no request to an address it chose.
 *
 * @returns The checks that ran, and the credential that the proof secures when it is valid and the issuer check did not fail.
 */
export async function authenticate(prepared: Prepared, context: Context): Promise<Authenticated> {
  let step: ProofStep;
  if (prepared.form === "jws") {
    step = await jwsProof(prepared.jws, context);
  } else {
    const read = readObject(prepared.value, context);
    if ("reason" in read) return { checks: { format: checkOf("format", "failed", read.reason) } };
    const kind = verifiedKindOf(read.credential.type);
    if (kind === undefined) return { checks: unknownKind() };
    step = await dataIntegrityProof(prepared.value, read.credential, kind, context);
  }
  if ("checks" in step) return { checks: step.checks };
  const { credential, kind, raw, key, timeFault } = step.secured;
  const issuer = step.secured.issuer ?? (await issuerCheckOf(credential, key, context));
  const checks: Checks = {
    format: formatPassed(),
    proof: checkOf("proof", "passed", `The proof verifies with the key ${key.id}.`),
    issuer,
  };
  return issuer.outcome === "failed" ? { checks } : { checks, authentic: { credential, kind, raw, timeFault } };
}
