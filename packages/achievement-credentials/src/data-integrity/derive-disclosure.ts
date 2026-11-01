import { DataError } from "@interopkit/core";
import { checkRecord } from "@interopkit/core/checks";
import { deriveProof } from "@interopkit/selective-disclosure";
import type { IssuableCredential } from "../model/index.js";
import { credentialOrReason } from "../read/internal.js";
import { failOperation } from "./document-loader.js";
import { type DisclosureOptions, disclosureSettings } from "./options.js";
import { withProofList, withProofObject } from "./proof-list.js";

/**
 * Derives a disclosure of a credential that has an `ecdsa-sd-2023` base proof: a credential with the parts that the issuer made
 * mandatory and the parts that the holder selects, and a derived proof that a verifier checks.
 *
 * @remarks
 * A holder calls it; the base proof never goes to a verifier, because it holds the key that relabels the blank nodes and the
 * signature of every statement. Disclosures of one credential can be linked to each other, since they share the base signature
 * and the key of the proof. The disclosure is checked as the readers check a credential: one that hides what the model
 * requires is refused with the pointers to add.
 *
 * @param credential - The credential with its base proof.
 * @param options - The pointers to reveal and the loader of contexts.
 * @returns The disclosure.
 * @throws `DataError` when the credential has no base proof, a pointer selects nothing, or the disclosure is not a credential.
 * @throws `ServiceError` when a context cannot be fetched.
 * @throws The `reason` of the signal when it aborts.
 */
export async function deriveDisclosure(
  credential: IssuableCredential,
  options: DisclosureOptions,
): Promise<IssuableCredential> {
  const { selectivePointers, contexts, signal } = disclosureSettings(options);
  checkRecord(credential, "The credential must be an object");
  signal?.throwIfAborted();
  let derived: Readonly<Record<string, unknown>>;
  try {
    derived = await deriveProof(withProofObject({ ...structuredClone(credential) }), {
      selectivePointers,
      contexts,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    return failOperation(error, signal);
  }
  const checked = credentialOrReason(derived, "The disclosure");
  if ("reason" in checked) {
    throw new DataError(`${checked.reason} Add the pointers of what the model requires to selectivePointers.`);
  }
  return withProofList(derived) as unknown as IssuableCredential;
}
