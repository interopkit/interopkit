import { parseDateTime } from "@interopkit/core/checks";
import type { AnyVerifiableCredential, VerificationCheck } from "../model/index.js";
import { checkOf } from "./result.js";

const MILLISECONDS_PER_SECOND = 1000;

/** Reads the start and the end of the validity of a credential of either data model. */
function periodOf(credential: AnyVerifiableCredential): {
  readonly from: string;
  readonly until: string | undefined;
} {
  return "issuanceDate" in credential
    ? { from: credential.issuanceDate, until: credential.expirationDate }
    : { from: credential.validFrom, until: credential.validUntil };
}

/**
 * Checks that a credential is valid now (Open Badges 9.1): not before its `validFrom` (`issuanceDate` under Data Model 1.1) and
 * not after its `validUntil` (`expirationDate`), with the skew of the clock. The time claims of a JWS count as the same period.
 */
export function checkValidity(
  credential: AnyVerifiableCredential,
  timeFault: string | undefined,
  now: number,
  skewSeconds: number,
): VerificationCheck {
  if (timeFault !== undefined) return checkOf("validity", "failed", timeFault);
  const { from, until } = periodOf(credential);
  const skew = skewSeconds * MILLISECONDS_PER_SECOND;
  // The reader refuses a start that is no date and time, and an end that is no date and time.
  const start = parseDateTime(from);
  const end = until === undefined ? undefined : parseDateTime(until);
  if (now + skew < start) return checkOf("validity", "failed", `The credential is not valid before ${from}.`);
  if (end !== undefined && now - skew >= end) {
    return checkOf("validity", "failed", `The credential expired at ${until}.`);
  }
  return checkOf("validity", "passed", "The credential is valid now.");
}
