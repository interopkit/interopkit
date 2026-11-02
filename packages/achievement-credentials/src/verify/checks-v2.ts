import { matchesIdentifier } from "../issue/index.js";
import type { AssertionV2, VerificationCheck } from "../model/index.js";
import { parseDateTimeV2 } from "../read/internal.js";
import type { KnownRecipient } from "./options.js";
import { checkOf } from "./result.js";

const MILLISECONDS_PER_SECOND = 1000;

/** The kinds of identity of Open Badges 3.0 that name the same property of a profile as a kind of 2.0. */
const KINDS_OF_3_0: Readonly<Record<string, string>> = { emailAddress: "email", phoneNumber: "telephone" };

/**
 * Checks that a 2.0 assertion is valid now (Open Badges 2.0, Verification): it was not issued in the future and has not expired,
 * with the skew of the clock.
 */
export function checkValidityV2(assertion: AssertionV2, now: number, skewSeconds: number): VerificationCheck {
  const skew = skewSeconds * MILLISECONDS_PER_SECOND;
  const issued = parseDateTimeV2(assertion.issuedOn);
  if (issued !== undefined && now + skew < issued) {
    return checkOf("validity", "failed", `The assertion was issued in the future, on ${assertion.issuedOn}.`);
  }
  const expires = assertion.expires === undefined ? undefined : parseDateTimeV2(assertion.expires);
  if (expires !== undefined && now - skew >= expires) {
    return checkOf("validity", "failed", `The assertion expired on ${assertion.expires}.`);
  }
  return checkOf("validity", "passed", "The assertion was issued and has not expired.");
}

/**
 * Checks the recipient of a 2.0 assertion against the one that the verifier knows (Open Badges 2.0, Verification): the known
 * identifier, of the kind of the recipient, is its plain value or matches its hash; a known `id` is a recipient of the kind
 * `id`. A kind of Open Badges 3.0 counts as the kind of 2.0 for the same property: `emailAddress` as `email`, `phoneNumber` as
 * `telephone`.
 */
export function checkRecipientV2(assertion: AssertionV2, known: KnownRecipient | undefined): VerificationCheck {
  if (known === undefined) return checkOf("recipient", "skipped", "No recipient was given to compare with.");
  const { recipient } = assertion;
  const candidates = [
    ...(known.identifier === undefined
      ? []
      : [{ type: KINDS_OF_3_0[known.identifier.type] ?? known.identifier.type, value: known.identifier.value }]),
    ...(known.id === undefined ? [] : [{ type: "id", value: known.id }]),
  ];
  return candidates.some((candidate) => matchesIdentifier(recipient, candidate))
    ? checkOf("recipient", "passed", `The recipient of the assertion is the known ${recipient.type}.`)
    : checkOf("recipient", "failed", "The recipient of the assertion is not the known recipient.");
}
