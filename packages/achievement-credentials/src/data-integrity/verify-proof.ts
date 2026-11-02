import { DataError, untilAborted } from "@interopkit/core";
import { describe, isRecord } from "@interopkit/core/checks";
import { isBaseProof } from "@interopkit/selective-disclosure";
import { textWithinLimits } from "../json-text.js";
import { bindKey } from "../keys/internal.js";
import type {
  AnyVerifiableCredential,
  DataIntegritySuite,
  IssuableCredential,
  ProofResult,
  VerificationKey,
} from "../model/index.js";
import { credentialOrReason } from "../read/internal.js";
import { rethrowOperational } from "./document-loader.js";
import { type DataIntegrityVerifyOptions, type VerifySettings, verifySettings } from "./options.js";
import { processingProblem } from "./processing-limits.js";
import { BUILT_IN_SUITES, ED25519_SIGNATURE_2020 } from "./suites.js";

const MILLISECONDS_PER_SECOND = 1000;

/**
 * The most proofs of one credential that are checked, in order. Each proof is checked on its own, canonizes its options and may
 * name another key to fetch, so the work and the requests grow with their number: 5,000 values of one property and 300 proofs took
 * 95 seconds before the credential was canonized once for all. Open Badges allows one or more Linked Data proofs, and a
 * credential has one or two in practice.
 */
const MAX_CHECKED_PROOFS = 4;

/** The `proofPurpose` of a proof that makes a credential an assertion of its issuer. */
const ASSERTION = "assertionMethod";

/** What a proof is not valid for, and whether that is a matter of what the verifier has and not of the proof. */
interface Refusal {
  readonly reason: string;
  /** Whether no suite of the verifier checks the proof: a proof that is neither valid nor invalid for it. */
  readonly unavailable: boolean;
}

/** The suite that checks a proof, or the reason that none does. */
function suiteOf(proof: Readonly<Record<string, unknown>>, settings: VerifySettings): DataIntegritySuite | Refusal {
  if (proof.type === ED25519_SIGNATURE_2020.cryptosuite) {
    return settings.legacyProofs
      ? ED25519_SIGNATURE_2020
      : {
          reason: "The proof is an Ed25519Signature2020, which is refused unless legacyProofs is set.",
          unavailable: false,
        };
  }
  if (proof.type !== "DataIntegrityProof" || typeof proof.cryptosuite !== "string") {
    return {
      reason: `The proof is a ${describe(proof.type)}, and a Data Integrity proof is a DataIntegrityProof with a cryptosuite.`,
      unavailable: false,
    };
  }
  const found = [...settings.suites, ...BUILT_IN_SUITES].find(({ cryptosuite }) => cryptosuite === proof.cryptosuite);
  return found ?? { reason: `No suite verifies the cryptosuite ${proof.cryptosuite}.`, unavailable: true };
}

/** Finds what is wrong with a proof before its signature is looked at, or `undefined`. */
function proofProblem(proof: Readonly<Record<string, unknown>>, settings: VerifySettings): string | undefined {
  if (proof.proofPurpose !== ASSERTION) {
    return `The proofPurpose ${describe(proof.proofPurpose)} must be ${ASSERTION}: a credential is an assertion of its issuer.`;
  }
  if (typeof proof.verificationMethod !== "string" || proof.verificationMethod === "") {
    return "The proof names no verificationMethod.";
  }
  if (typeof proof.expires === "string") {
    const expires = Date.parse(proof.expires);
    const now = settings.clock.now();
    if (!(expires + settings.clockSkewSeconds * MILLISECONDS_PER_SECOND > now))
      return `The proof expired at ${proof.expires}.`;
  }
  return undefined;
}

/**
 * Asks a suite whether a proof verifies. A suite that refuses the document with a `DataError`, as for a limit, gives the reason
 * of the check; any other error is the host's and passes through.
 */
async function suiteVerdict(
  suite: DataIntegritySuite,
  unsecured: Readonly<Record<string, unknown>>,
  proof: Readonly<Record<string, unknown>>,
  key: VerificationKey,
  settings: VerifySettings,
): Promise<boolean | Refusal> {
  try {
    return await suite.verify(unsecured, proof, {
      publicKeyJwk: key.publicKeyJwk,
      contexts: settings.contexts,
      maxBytes: settings.maxInputBytes,
      maxTokens: settings.maxJsonLdTokens,
      ...(settings.signal === undefined ? {} : { signal: settings.signal }),
    });
  } catch (error) {
    if (error instanceof DataError) return { reason: error.message, unavailable: false };
    throw error;
  }
}

/** Checks one proof of a credential, and returns the key that verified it or the reason that it did not. */
async function checkProof(
  unsecured: Readonly<Record<string, unknown>>,
  candidate: unknown,
  issuer: string,
  settings: VerifySettings,
): Promise<{ readonly key: VerificationKey; readonly bound: boolean } | Refusal> {
  // The model has refused a proof that is no object; the empty object stands in for the type, and has no type to name.
  const proof = isRecord(candidate) ? candidate : {};
  if (isBaseProof(proof)) {
    return {
      reason: "The proof is an ecdsa-sd-2023 base proof, which holds what a holder hides: derive a disclosure first.",
      unavailable: false,
    };
  }
  const suite = suiteOf(proof, settings);
  if ("reason" in suite) return suite;
  const problem = proofProblem(proof, settings);
  if (problem !== undefined) return { reason: problem, unavailable: false };
  const method = String(proof.verificationMethod);
  // A resolver is the host's port and may ignore the signal it is given: the wait ends at the signal either way.
  const call = settings.signal === undefined ? undefined : { signal: settings.signal };
  const resolved = await untilAborted(settings.keys.resolve(method, call), settings.signal);
  if (resolved === undefined)
    return { reason: `No key is named by the verificationMethod ${method}.`, unavailable: false };
  const verdict = await suiteVerdict(suite, unsecured, proof, resolved, settings);
  if (typeof verdict !== "boolean") return verdict;
  if (!verdict) return { reason: `The proof does not verify with the key ${resolved.id}.`, unavailable: false };
  const binding = await bindKey(resolved, issuer, settings);
  return "reason" in binding ? { reason: binding.reason, unavailable: false } : { key: resolved, bound: binding.bound };
}

/** Checks the credential before anything reads it: its size, tokens and depth, and the model; returns the credential as the model has it. */
function readInput(
  credential: IssuableCredential,
  settings: VerifySettings,
): { readonly value: AnyVerifiableCredential } | { readonly reason: string } {
  const text = textWithinLimits(
    credential,
    { maxCharacters: settings.maxInputBytes, maxDepth: settings.maxDepth, maxTokens: settings.maxTokens },
    "The credential",
  );
  return "reason" in text ? text : credentialOrReason(credential, "The credential");
}

/** What the proofs of a credential came to: the first that is valid, or why none is. */
type ProofVerdict =
  | {
      readonly valid: true;
      readonly credential: AnyVerifiableCredential;
      readonly key: VerificationKey;
      readonly bound: boolean;
    }
  | { readonly valid: false; readonly reason: string; readonly unavailable: boolean };

/** Looks at every proof of a credential that has been read, in order, and keeps the first that is valid or else the verdict on the first. */
async function proofsOf(
  document: Readonly<Record<string, unknown>>,
  credential: AnyVerifiableCredential,
  settings: VerifySettings,
): Promise<ProofVerdict> {
  const { proof: secured, ...unsecured } = document;
  const proofs = Array.isArray(secured) ? secured : secured === undefined ? [] : [secured];
  const issuer = typeof credential.issuer === "string" ? credential.issuer : credential.issuer.id;
  let first: Refusal = { reason: "The credential has no proof.", unavailable: false };
  // A credential that is too large for the processors costs no work, whatever the number of its proofs.
  const tooLarge = proofs.length === 0 ? undefined : processingProblem(document, settings.maxJsonLdTokens);
  if (tooLarge !== undefined) return { valid: false, reason: tooLarge, unavailable: false };
  for (const [index, proof] of proofs.slice(0, MAX_CHECKED_PROOFS).entries()) {
    try {
      const checked = await checkProof(unsecured, proof, issuer, settings);
      if ("key" in checked) return { valid: true, credential, key: checked.key, bound: checked.bound };
      if (index === 0) first = checked;
    } catch (error) {
      rethrowOperational(error, settings.signal);
      throw error;
    }
  }
  const ignored =
    proofs.length > MAX_CHECKED_PROOFS
      ? ` Only the first ${MAX_CHECKED_PROOFS} of its ${proofs.length} proofs are checked.`
      : "";
  return { valid: false, ...first, reason: `${first.reason}${ignored}` };
}

/**
 * Looks at the proofs of a credential that the caller has read within its limits, and tells a proof that no suite checks from
 * one that is not valid. It reads and counts nothing again, which is what `verifyCredential` needs.
 *
 * @param document - The credential as it was received, which the proofs sign.
 * @param credential - The same credential, read into the model.
 * @param options - The options of `verifyProof`.
 * @returns The verdict.
 * @throws `DataError` when an option is not valid.
 * @throws `ServiceError` when a key, what the issuer publishes or a context cannot be read.
 * @throws The `reason` of the signal when it aborts.
 */
export async function inspectProofs(
  document: Readonly<Record<string, unknown>>,
  credential: AnyVerifiableCredential,
  options: DataIntegrityVerifyOptions,
): Promise<ProofVerdict> {
  const settings = verifySettings(options);
  settings.signal?.throwIfAborted();
  return await proofsOf(document, credential, settings);
}

/**
 * Verifies the Data Integrity proofs of a credential: the signature, with a key that belongs to the issuer.
 *
 * @remarks
 * The credential is checked for its size and depth before anything reads it, and as the readers check a credential. A credential
 * that has more tokens or bytes than `maxJsonLdTokens` and `maxInputBytes` allow a JSON-LD processor, or needs more than 1,000
 * runs of the Hash N-Degree Quads algorithm to canonicalize, is not valid, and the reason names the limit. The first four proofs
 * are looked at in order, and the result is the first that is valid; if none is, the reason of the first. The credential is
 * canonicalized once for all of them. A proof must have the
 * purpose `assertionMethod`, a cryptosuite that a suite verifies (the built-in `eddsa-rdfc-2022`, `ecdsa-rdfc-2019`
 * and `ecdsa-sd-2023`, those of `suites`, and `Ed25519Signature2020` with `legacyProofs`), and a key that the resolver finds and
 * that the issuer publishes, unless `allowUnboundKeys` is set. A credential that still carries an `ecdsa-sd-2023` base proof is
 * not valid: the holder derives a disclosure first. Every context is loaded through `contexts`. A suite of `suites` is given the
 * credential without its proof and the limits, and may refuse a document with a `DataError`, which becomes the reason.
 *
 * @param credential - The credential, as an object.
 * @param options - The resolver, the clock, the loader of contexts and the other options.
 * @returns The credential with the key that verified it, or the reason that no proof is valid.
 * @throws `DataError` when an argument is not valid.
 * @throws `ServiceError` when a key, what the issuer publishes or a context cannot be read.
 * @throws The `reason` of the signal when it aborts.
 * @see {@link https://www.w3.org/TR/vc-data-integrity/ | Verifiable Credential Data Integrity 1.0}
 */
export async function verifyProof(
  credential: IssuableCredential,
  options: DataIntegrityVerifyOptions,
): Promise<ProofResult> {
  const settings = verifySettings(options);
  if (!isRecord(credential)) throw new DataError(`The credential must be an object, found ${describe(credential)}.`);
  settings.signal?.throwIfAborted();
  const read = readInput(credential, settings);
  if ("reason" in read) return { valid: false, reason: read.reason };
  const verdict = await proofsOf(credential, read.value, settings);
  return verdict.valid ? verdict : { valid: false, reason: verdict.reason };
}
