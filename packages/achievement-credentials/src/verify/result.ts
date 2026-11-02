import {
  type AnyCredential,
  type CheckOutcome,
  VERIFICATION_CHECKS,
  type VerificationCheck,
  type VerificationCheckName,
  type VerificationResult,
} from "../model/index.js";

/** The checks that a verification has run, by name. */
export type Checks = Partial<Record<VerificationCheckName, VerificationCheck>>;

/** Makes the result of one check. */
export function checkOf(check: VerificationCheckName, outcome: CheckOutcome, detail: string): VerificationCheck {
  return { check, outcome, detail };
}

/** What a credential came to, besides its own checks. */
export interface Parts {
  /** What the proof secures, when the proof is valid and the issuer check did not fail. */
  readonly credential?: AnyCredential | undefined;
  readonly endorsements?: readonly VerificationResult[];
  readonly nested?: readonly VerificationResult[];
}

/**
 * Tells whether a check lets a credential be verified: it passed, it did not apply, or what it needs could not be read and the
 * host accepts that. A proof that cannot be checked never lets a credential be verified.
 */
function accepts(check: VerificationCheck, unavailable: "fail" | "warn"): boolean {
  if (check.outcome === "passed" || check.outcome === "skipped") return true;
  return check.outcome === "unavailable" && unavailable === "warn" && check.check !== "proof";
}

/**
 * Makes the result of a verification from the checks that ran. Every check is in the result, in the order of Open Badges 9: a
 * check that did not run is `skipped` and says which check stopped the others.
 *
 * @param checks - The checks that ran.
 * @param unavailable - What the host asked to do about a check that could not be made.
 * @param parts - The credential that the proof secures and the results of what it holds.
 */
export function resultOf(checks: Checks, unavailable: "fail" | "warn", parts: Parts = {}): VerificationResult {
  const stopper = VERIFICATION_CHECKS.find((name) => {
    const outcome = checks[name]?.outcome;
    return outcome === "failed" || outcome === "unavailable";
  });
  const all = VERIFICATION_CHECKS.map(
    (name) =>
      checks[name] ??
      checkOf(
        name,
        "skipped",
        stopper === undefined ? "Not run." : `Not run: the check of the ${stopper} did not pass.`,
      ),
  );
  const endorsements = parts.endorsements ?? [];
  const nested = parts.nested ?? [];
  const verified =
    all.every((check) => accepts(check, unavailable)) &&
    endorsements.every((result) => result.verified) &&
    nested.every((result) => result.verified);
  return {
    verified,
    ...(parts.credential === undefined ? {} : { credential: parts.credential }),
    checks: all,
    endorsements,
    nested,
  };
}
