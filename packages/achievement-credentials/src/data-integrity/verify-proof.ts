import { DataError, raceAbort, readClock, ServiceError } from "@interopkit/core";
import { describe, isRecord } from "@interopkit/core/checks";
import { isBaseProof } from "@interopkit/selective-disclosure";
import { textWithinLimits } from "../json-text.js";
import { bindKey } from "../keys/internal.js";
import type {
  AnyVerifiableCredential,
  DataIntegritySuite,
  IssuableCredential,
  ProofResult,
  VerificationCheck,
  VerificationKey,
} from "../model/index.js";
import { credentialOrReason } from "../read/internal.js";
import { rethrowOperational } from "./document-loader.js";
import { type DataIntegrityVerifyOptions, type VerifySettings, verifySettings } from "./options.js";
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
    const now = readClock(settings.clock);
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
  secured: Readonly<Record<string, unknown>>,
  proof: Readonly<Record<string, unknown>>,
  key: VerificationKey,
  settings: VerifySettings,
): Promise<boolean | Refusal> {
  try {
    const verifying = suite.verify(secured, proof, {
      publicKeyJwk: key.publicKeyJwk,
      contexts: settings.contexts,
      maxBytes: settings.maxInputBytes,
      maxTokens: settings.maxJsonLdTokens,
      ...(settings.signal === undefined ? {} : { signal: settings.signal }),
    });
    // A suite of the host may ignore the signal it is given: the wait ends at the signal either way.
    return await raceAbort(Promise.resolve(verifying), { signal: settings.signal });
  } catch (error) {
    if (error instanceof DataError) return { reason: error.message, unavailable: false };
    throw error;
  }
}

/** What one proof came to: the key that verified it, which is not yet tied to the issuer, or why it is not valid. */
type Checked = { readonly key: VerificationKey } | Refusal;

/** Checks the signature of one proof over the document as the proof secures it, and returns the key that verified it. */
async function checkSignature(
  secured: Readonly<Record<string, unknown>>,
  proof: Readonly<Record<string, unknown>>,
  settings: VerifySettings,
): Promise<Checked> {
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
  const resolved = await raceAbort(settings.keys.resolve(method, call), { signal: settings.signal });
  if (resolved === undefined)
    return { reason: `No key is named by the verificationMethod ${method}.`, unavailable: false };
  const verdict = await suiteVerdict(suite, secured, proof, resolved, settings);
  if (typeof verdict !== "boolean") return verdict;
  return verdict
    ? { key: resolved }
    : { reason: `The proof does not verify with the key ${resolved.id}.`, unavailable: false };
}

/** The proofs of a credential as they are checked: each at most once, and no more of them than `MAX_CHECKED_PROOFS`. */
interface ProofSet {
  /** Every proof of the credential, which a `previousProof` may name. */
  readonly all: readonly unknown[];
  /** The credential without its proofs. */
  readonly unsecured: Readonly<Record<string, unknown>>;
  readonly settings: VerifySettings;
  /** What each proof came to, by its place in `all`. */
  readonly checked: Map<number, Promise<Checked>>;
}

/** Reads the identifiers of the proofs that a proof names in `previousProof`: none, or the reason that they cannot be read. */
function previousOf(proof: Readonly<Record<string, unknown>>): readonly string[] | Refusal {
  const { previousProof } = proof;
  if (previousProof === undefined) return [];
  const named = Array.isArray(previousProof) ? previousProof : [previousProof];
  return named.length > 0 && named.every((id) => typeof id === "string")
    ? named
    : { reason: "The previousProof of the proof must be the id of a proof, or a list of them.", unavailable: false };
}

/**
 * Checks the proof at a place of the set. A proof that names a `previousProof` secures the credential with the proofs that it
 * names, and is valid only when each of them is (Data Integrity 4.5): a chain is checked from the proof back, and a proof that
 * names one that the credential lacks, or names itself through others, is not valid.
 *
 * @param set - The proofs and what each came to.
 * @param index - The place of the proof in the set.
 * @param chain - The places of the proofs that named this one, to tell a cycle.
 */
function proofAt(set: ProofSet, index: number, chain: readonly number[]): Promise<Checked> {
  if (chain.includes(index)) {
    return Promise.resolve({ reason: "The proofs name each other in a cycle of previousProof.", unavailable: false });
  }
  const earlier = set.checked.get(index);
  if (earlier !== undefined) return earlier;
  if (set.checked.size >= MAX_CHECKED_PROOFS) {
    return Promise.resolve({
      reason: `The chain of proofs needs more than the ${MAX_CHECKED_PROOFS} proofs that are checked.`,
      unavailable: false,
    });
  }
  const checking = checkChained(set, index, chain);
  set.checked.set(index, checking);
  return checking;
}

/** Checks a proof after the proofs that it names, over the credential with those proofs. */
async function checkChained(set: ProofSet, index: number, chain: readonly number[]): Promise<Checked> {
  const candidate = set.all[index];
  // The model has refused a proof that is no object; the empty object stands in for the type, and has no type to name.
  const proof = isRecord(candidate) ? candidate : {};
  const named = previousOf(proof);
  if ("reason" in named) return named;
  const previous: unknown[] = [];
  for (const id of named) {
    const at = set.all.findIndex((other) => isRecord(other) && other.id === id);
    if (at === -1) return { reason: `The previousProof ${id} names no proof of the credential.`, unavailable: false };
    const checked = await proofAt(set, at, [...chain, index]);
    if ("reason" in checked) {
      return {
        reason: `The proof ${id} that it names is not valid: ${checked.reason}`,
        unavailable: checked.unavailable,
      };
    }
    previous.push(set.all[at]);
  }
  const secured = previous.length === 0 ? set.unsecured : { ...set.unsecured, proof: previous };
  return await checkSignature(secured, proof, set.settings);
}

/**
 * Ties the key of a proof that verifies to the issuer of the credential: the `issuer` check, which passes, fails, could not be
 * made, or is skipped when the host accepts keys that are not bound.
 */
export type IssuerBinding = (key: VerificationKey) => Promise<VerificationCheck>;

/** Checks the credential before anything reads it: its size, tokens and depth, and the model; returns the credential as the model has it. */
function readInput(
  credential: IssuableCredential,
  settings: VerifySettings,
): { readonly value: AnyVerifiableCredential } | { readonly reason: string } {
  try {
    textWithinLimits(credential, settings, "The credential");
  } catch (error) {
    return { reason: error instanceof DataError ? error.message : "The credential is not JSON." };
  }
  return credentialOrReason(credential, "The credential");
}

/** What the proofs of a credential came to: the proof that is valid with the issuer check of its key, or why none is. */
type ProofVerdict =
  | {
      readonly valid: true;
      readonly credential: AnyVerifiableCredential;
      readonly key: VerificationKey;
      /** `passed` or `skipped` for a key of the issuer; `failed` or `unavailable` when no valid proof has one. */
      readonly issuer: VerificationCheck;
    }
  | { readonly valid: false; readonly reason: string; readonly unavailable: boolean };

/** A proof that is valid, with the issuer check of its key. */
interface Valid {
  readonly key: VerificationKey;
  readonly issuer: VerificationCheck;
}

/**
 * Finds the proof of a set that counts: the first that is valid and whose key belongs to the issuer. A proof by another party,
 * such as a witness, comes first in a set as often as last, so a valid proof whose key is not the issuer's does not end the
 * search. When no proof is the issuer's, the first valid one is kept with its issuer check, and when none is valid, the refusal
 * of the first.
 */
async function bestProof(set: ProofSet, bind: IssuerBinding): Promise<Valid | Refusal> {
  let first: Refusal = { reason: "The credential has no proof.", unavailable: false };
  let unbound: Valid | undefined;
  for (const index of set.all.keys()) {
    if (index >= MAX_CHECKED_PROOFS) break;
    const checked = await proofAt(set, index, []);
    if ("reason" in checked) {
      if (index === 0) first = checked;
      continue;
    }
    const issuer = await bind(checked.key);
    if (issuer.outcome === "passed" || issuer.outcome === "skipped") return { key: checked.key, issuer };
    unbound ??= { key: checked.key, issuer };
  }
  return unbound ?? first;
}

/** Looks at the proofs of a credential that has been read, within the limit of what a processor reads, and keeps the one that counts. */
async function proofsOf(
  document: Readonly<Record<string, unknown>>,
  credential: AnyVerifiableCredential,
  settings: VerifySettings,
  bind: IssuerBinding,
): Promise<ProofVerdict> {
  const { proof: secured, ...unsecured } = document;
  const all = Array.isArray(secured) ? secured : secured === undefined ? [] : [secured];
  if (all.length === 0) return { valid: false, reason: "The credential has no proof.", unavailable: false };
  // A credential that is too large for the processors costs no work, whatever the number of its proofs.
  try {
    textWithinLimits(
      document,
      { tokensOption: "maxJsonLdTokens", maxTokens: settings.maxJsonLdTokens },
      "The credential",
    );
  } catch (error) {
    const reason = error instanceof DataError ? error.message : "The credential is not JSON.";
    return { valid: false, reason, unavailable: false };
  }
  try {
    const best = await bestProof({ all, unsecured, settings, checked: new Map() }, bind);
    if ("key" in best) return { valid: true, credential, ...best };
    const ignored =
      all.length > MAX_CHECKED_PROOFS
        ? ` Only the first ${MAX_CHECKED_PROOFS} of its ${all.length} proofs are checked.`
        : "";
    return { valid: false, ...best, reason: `${best.reason}${ignored}` };
  } catch (error) {
    rethrowOperational(error, settings.signal);
    throw error;
  }
}

/**
 * Looks at the proofs of a credential that the caller has read within its limits, and tells a proof that no suite checks from
 * one that is not valid. It reads and counts nothing again, which is what `verifyCredential` needs.
 *
 * @param document - The credential as it was received, which the proofs sign.
 * @param credential - The same credential, read into the model.
 * @param options - The options of `verifyProof`.
 * @param bind - Ties the key of a valid proof to the issuer, as the caller reports it.
 * @returns The verdict.
 * @throws `DataError` when an option is not valid.
 * @throws `ServiceError` when a key or a context cannot be read.
 * @throws The `reason` of the signal when it aborts.
 */
export async function inspectProofs(
  document: Readonly<Record<string, unknown>>,
  credential: AnyVerifiableCredential,
  options: DataIntegrityVerifyOptions,
  bind: IssuerBinding,
): Promise<ProofVerdict> {
  const settings = verifySettings(options);
  settings.signal?.throwIfAborted();
  return await proofsOf(document, credential, settings, bind);
}

/**
 * Verifies the Data Integrity proofs of a credential: the signature, with a key that belongs to the issuer.
 *
 * @remarks
 * The credential is checked for its size and depth before anything reads it, and as the readers check a credential. A credential
 * that has more tokens or bytes than `maxJsonLdTokens` and `maxInputBytes` allow a JSON-LD processor, or needs more than 1,000
 * runs of the Hash N-Degree Quads algorithm to canonicalize, is not valid, and the reason names the limit. At most four proofs
 * are checked, in order, and the result is the first that is valid and whose key the issuer publishes; if none is, the reason
 * of the first. A proof that names a `previousProof` is checked over the credential with the proofs that it names, and is valid
 * only when they are (a proof chain, Data Integrity 4.5). The credential is canonicalized once for all the proofs of a set. A
 * proof must have the purpose `assertionMethod`, a cryptosuite that a suite verifies (the built-in `eddsa-rdfc-2022`,
 * `ecdsa-rdfc-2019` and `ecdsa-sd-2023`, those of `suites`, and `Ed25519Signature2020` with `legacyProofs`), and a key that the
 * resolver finds and that the issuer publishes, unless `allowUnboundKeys` is set. A credential that still carries an
 * `ecdsa-sd-2023` base proof is not valid: the holder derives a disclosure first. Every context is loaded through `contexts`. A
 * suite of `suites` is given the credential as the proof secures it and the limits, and may refuse a document with a
 * `DataError`, which becomes the reason.
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
  const issuer = issuerIdOf(read.value);
  const verdict = await proofsOf(credential, read.value, settings, (key) => bindKey(key, issuer, settings));
  if (!verdict.valid) return { valid: false, reason: verdict.reason };
  const { outcome, detail } = verdict.issuer;
  if (outcome === "unavailable") throw new ServiceError(detail, 0, "");
  if (outcome === "failed") return { valid: false, reason: detail };
  return { valid: true, credential: verdict.credential, key: verdict.key, bound: outcome === "passed" };
}

/** Reads the identifier of the issuer of a credential. */
function issuerIdOf(credential: AnyVerifiableCredential): string {
  return typeof credential.issuer === "string" ? credential.issuer : credential.issuer.id;
}
