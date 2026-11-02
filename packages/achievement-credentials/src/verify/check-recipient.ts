import { isRecord } from "@interopkit/core/checks";
import { matchesIdentifier } from "../issue/index.js";
import type { AnyVerifiableCredential, VerificationCheck } from "../model/index.js";
import type { KnownRecipient } from "./options.js";
import { checkOf } from "./result.js";

/**
 * Checks the recipient of a credential against the one that the verifier knows (Open Badges 9.1 and 9.3): the known `id` equals
 * the `id` of the subject, or a known identifier matches one that the subject carries, by its type and by its hash or its
 * plain value. Either is a match.
 */
export function checkRecipient(
  credential: AnyVerifiableCredential,
  known: KnownRecipient | undefined,
): VerificationCheck {
  if (known === undefined) return checkOf("recipient", "skipped", "No recipient was given to compare with.");
  const subject: unknown = credential.credentialSubject;
  if (known.id !== undefined && isRecord(subject) && subject.id === known.id) {
    return checkOf("recipient", "passed", "The id of the subject is the id of the known recipient.");
  }
  const identifiers: unknown = isRecord(subject) ? subject.identifier : undefined;
  if (known.identifier !== undefined && Array.isArray(identifiers)) {
    const { identifier } = known;
    if (identifiers.some((identity) => matchesIdentifier(identity, identifier))) {
      return checkOf("recipient", "passed", `An identifier of the subject matches the known ${identifier.type}.`);
    }
  }
  return checkOf("recipient", "failed", "The subject of the credential is not the known recipient.");
}
