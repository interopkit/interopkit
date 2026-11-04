import { DataError, ServiceError } from "@interopkit/core";
import { isSameCredential } from "../compare/index.js";
import { VERIFICATION_CHECKS, type VerificationCheck } from "../model/index.js";
import { refreshCredentialWith } from "../refresh/internal.js";
import { type Authentic, type Authenticated, authenticate } from "./authenticate.js";
import type { Context } from "./context.js";
import { preparedOf } from "./input.js";
import { type Checks, checkOf } from "./result.js";

/** What a refresh came to: its check, and the credential that took the place of the original when it succeeded. */
export interface Refreshed {
  readonly check: VerificationCheck;
  readonly replacement?: Authenticated & { readonly authentic: Authentic };
}

/**
 * The most credentials that one call refreshes. Each refresh fetches an address that the credential names and keeps what it
 * gives, up to `maxBytes`, in the result: a CLR of 1,000 credentials that each name a refresh service would otherwise fetch 1,000
 * of them and keep about 700 MiB. The credential that was passed and its endorsements fit in it.
 */
const MAX_REFRESHES = 16;

/** Says which check of a credential did not pass. */
function firstProblem(checks: Checks): string {
  const found = VERIFICATION_CHECKS.map((name) => checks[name]).find(
    (check) => check !== undefined && check.outcome !== "passed" && check.outcome !== "skipped",
  );
  return found === undefined ? "it is not valid" : `the check of the ${found.check} says: ${found.detail}`;
}

/**
 * Follows the refresh service of a credential, once, after its proof (Open Badges 9.1): the answer is a candidate that must be
 * authentic itself and the same credential (Open Badges 10), or the refresh has not succeeded and the verification goes on with
 * the original. A candidate is not refreshed again, whatever it names.
 */
export async function refresh(authentic: Authentic, context: Context): Promise<Refreshed> {
  const { settings } = context;
  const unavailable = (detail: string): Refreshed => ({ check: checkOf("refresh", "unavailable", detail) });
  if (!settings.refresh) return { check: checkOf("refresh", "skipped", "The option refresh is false.") };
  if ("refreshService" in authentic.credential) {
    if (context.refreshes.count >= MAX_REFRESHES) {
      return {
        check: checkOf(
          "refresh",
          "skipped",
          `The call has refreshed ${MAX_REFRESHES} credentials, the most that one call refreshes, so this one is verified as it is.`,
        ),
      };
    }
    context.refreshes.count += 1;
  }
  let candidate: Awaited<ReturnType<typeof refreshCredentialWith>>;
  try {
    candidate = await refreshCredentialWith(authentic.credential, settings);
  } catch (error) {
    if (error instanceof ServiceError || error instanceof DataError) {
      return unavailable(`The refresh did not succeed, and the original credential is verified: ${error.message}`);
    }
    throw error;
  }
  if (candidate === undefined) {
    return { check: checkOf("refresh", "skipped", "The credential has no refresh service of a type that is known.") };
  }
  const prepared = preparedOf(candidate, settings);
  if ("reason" in prepared) return unavailable(`The refresh service answered no credential: ${prepared.reason}`);
  if (prepared.prepared.form === "address")
    return unavailable("The refresh service answered an address and no credential.");
  const refreshed = await authenticate(prepared.prepared, context);
  // A candidate whose key could not be tied to its issuer is not known to be authentic, so the original stays.
  if (refreshed.authentic === undefined || refreshed.checks.issuer?.outcome === "unavailable") {
    return unavailable(`The refreshed credential is not authentic: ${firstProblem(refreshed.checks)}`);
  }
  if (!isSameCredential(authentic.credential, refreshed.authentic.credential)) {
    return unavailable("The refreshed credential is another credential: its id or its issuer differs.");
  }
  return {
    check: checkOf("refresh", "passed", "The credential was refreshed, and the refreshed credential is verified."),
    replacement: { ...refreshed, authentic: refreshed.authentic },
  };
}
