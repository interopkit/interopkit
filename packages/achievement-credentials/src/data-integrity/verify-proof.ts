import { DataError } from "@interopkit/core";
import { describe, hasMoreTokensThan, isRecord, nestsDeeperThan } from "@interopkit/core/checks";
import { isBaseProof } from "@interopkit/selective-disclosure";
import { bindKey } from "../keys/internal.js";
import type {
  AnyCredential,
  DataIntegritySuite,
  IssuableCredential,
  ProofResult,
  VerificationKey,
} from "../model/index.js";
import { credentialOrReason } from "../read/internal.js";
import { rethrowOperational } from "./document-loader.js";
import { type DataIntegrityVerifyOptions, type VerifySettings, verifySettings } from "./options.js";
import { BUILT_IN_SUITES, ED25519_SIGNATURE_2020 } from "./suites.js";

const MILLISECONDS_PER_SECOND = 1000;

/** The `proofPurpose` of a proof that makes a credential an assertion of its issuer. */
const ASSERTION = "assertionMethod";

/** The suite that checks a proof, or the reason that none does. */
function suiteOf(proof: Readonly<Record<string, unknown>>, settings: VerifySettings): DataIntegritySuite | string {
  if (proof.type === ED25519_SIGNATURE_2020.cryptosuite) {
    return settings.legacyProofs
      ? ED25519_SIGNATURE_2020
      : "The proof is an Ed25519Signature2020, which is refused unless legacyProofs is set.";
  }
  if (proof.type !== "DataIntegrityProof" || typeof proof.cryptosuite !== "string") {
    return `The proof is a ${describe(proof.type)}, and a Data Integrity proof is a DataIntegrityProof with a cryptosuite.`;
  }
  const found = [...settings.suites, ...BUILT_IN_SUITES].find(({ cryptosuite }) => cryptosuite === proof.cryptosuite);
  return found ?? `No suite verifies the cryptosuite ${proof.cryptosuite}.`;
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

/** Checks one proof of a credential, and returns the key that verified it or the reason that it did not. */
async function checkProof(
  document: Readonly<Record<string, unknown>>,
  candidate: unknown,
  issuer: string,
  settings: VerifySettings,
): Promise<{ readonly key: VerificationKey; readonly bound: boolean } | { readonly reason: string }> {
  // The model has refused a proof that is no object; the empty object stands in for the type, and has no type to name.
  const proof = isRecord(candidate) ? candidate : {};
  if (isBaseProof(proof)) {
    return {
      reason: "The proof is an ecdsa-sd-2023 base proof, which holds what a holder hides: derive a disclosure first.",
    };
  }
  const suite = suiteOf(proof, settings);
  if (typeof suite === "string") return { reason: suite };
  const problem = proofProblem(proof, settings);
  if (problem !== undefined) return { reason: problem };
  const method = String(proof.verificationMethod);
  const resolved = await settings.keys.resolve(
    method,
    settings.signal === undefined ? undefined : { signal: settings.signal },
  );
  if (resolved === undefined) return { reason: `No key is named by the verificationMethod ${method}.` };
  const verdict = await suite.verify(document, proof, {
    publicKeyJwk: resolved.publicKeyJwk,
    contexts: settings.contexts,
    ...(settings.signal === undefined ? {} : { signal: settings.signal }),
  });
  if (!verdict) return { reason: `The proof does not verify with the key ${resolved.id}.` };
  const binding = await bindKey(resolved, issuer, settings);
  return "reason" in binding ? binding : { key: resolved, bound: binding.bound };
}

/** Checks the credential before anything reads it: its size and depth, and the model; returns the credential as the model has it. */
function readInput(
  credential: IssuableCredential,
  settings: VerifySettings,
): { readonly value: AnyCredential } | { readonly reason: string } {
  const text = JSON.stringify(credential);
  if (text.length > settings.maxInputBytes) {
    return {
      reason: `The credential has ${text.length} characters, more than the ${settings.maxInputBytes} that it may have.`,
    };
  }
  // The tokens and the levels are counted from the text, as for any text that is parsed; the object is read next.
  if (hasMoreTokensThan(text, settings.maxTokens)) {
    return { reason: `The credential has more than the ${settings.maxTokens} tokens of JSON that it may have.` };
  }
  if (nestsDeeperThan(text, settings.maxDepth))
    return { reason: `The credential nests more than ${settings.maxDepth} levels.` };
  return credentialOrReason(credential, "The credential");
}

/**
 * Verifies the Data Integrity proofs of a credential: the signature, with a key that belongs to the issuer.
 *
 * @remarks
 * The credential is checked for its size and depth before anything reads it, and as the readers check a credential. Every proof
 * is looked at in order, and the result is the first that is valid; if none is, the reason of the first. A proof must have the
 * purpose `assertionMethod`, a cryptosuite that a suite verifies (the built-in `eddsa-rdfc-2022`, `ecdsa-rdfc-2019`
 * and `ecdsa-sd-2023`, those of `suites`, and `Ed25519Signature2020` with `legacyProofs`), and a key that the resolver finds and
 * that the issuer publishes, unless `allowUnboundKeys` is set. A credential that still carries an `ecdsa-sd-2023` base proof is
 * not valid: the holder derives a disclosure first. Every context is loaded through `contexts`.
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
  const proofs = Array.isArray(credential.proof)
    ? credential.proof
    : credential.proof === undefined
      ? []
      : [credential.proof];
  const issuer = typeof read.value.issuer === "string" ? read.value.issuer : read.value.issuer.id;
  let first = "The credential has no proof.";
  for (const [index, proof] of proofs.entries()) {
    try {
      const checked = await checkProof(credential, proof, issuer, settings);
      if ("key" in checked) return { valid: true, credential: read.value, key: checked.key, bound: checked.bound };
      if (index === 0) first = checked.reason;
    } catch (error) {
      rethrowOperational(error, settings.signal);
      throw error;
    }
  }
  return { valid: false, reason: first };
}
