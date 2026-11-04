import { readClock } from "@interopkit/core";
import type { VerificationResult } from "../model/index.js";
import { type Authentic, authenticate } from "./authenticate.js";
import { checkRecipient } from "./check-recipient.js";
import { refresh } from "./check-refresh.js";
import { checkSchema } from "./check-schema.js";
import { checkStatus } from "./check-status.js";
import { checkValidity } from "./check-validity.js";
import type { Context } from "./context.js";
import { endorsementsOf, heldCredentialsOf } from "./held.js";
import { childOf } from "./input.js";
import { type Checks, checkOf, resultOf } from "./result.js";

/** Where a credential is in a verification: the one that was passed, a credential that a CLR holds, or an endorsement. */
export type Role = "root" | "held" | "endorsement";

/** The endorsements that a verification follows: those of a credential, and none of an endorsement, which has no step for them. */
function followedEndorsements(authentic: Authentic, role: Role): readonly unknown[] {
  return role === "endorsement" ? [] : endorsementsOf(authentic.credential);
}

/** Says why a credential holds more than a verification takes: its endorsements or, for a CLR, its credentials. */
function overLimit(authentic: Authentic, role: Role, context: Context): string | undefined {
  const { maxEndorsements, maxNestedCredentials } = context.settings;
  const endorsements = followedEndorsements(authentic, role).length;
  if (endorsements > maxEndorsements) {
    return `The credential has ${endorsements} endorsements, more than the ${maxEndorsements} that a verification takes.`;
  }
  const held = role === "root" && authentic.kind === "clr" ? heldCredentialsOf(authentic.credential).length : 0;
  return held > maxNestedCredentials
    ? `The CLR holds ${held} credentials, more than the ${maxNestedCredentials} that a verification takes.`
    : undefined;
}

/** Checks the recipient where it applies: of the credential that was passed, and not of what it holds or what endorses it. */
function recipientOf(authentic: Authentic, role: Role, context: Context) {
  if (role === "held") {
    return checkOf(
      "recipient",
      "skipped",
      "The recipient is checked on the CLR that was passed, not on the credentials it holds.",
    );
  }
  if (role === "endorsement" || authentic.kind === "endorsement") {
    return checkOf(
      "recipient",
      "skipped",
      "An endorsement is about an achievement or a profile, not about a recipient.",
    );
  }
  return checkRecipient(authentic.credential, context.settings.recipient);
}

/** Verifies each of the things that a credential holds, in order, each as its own credential. */
async function verifyEach(
  items: readonly unknown[],
  role: Role,
  context: Context,
): Promise<readonly VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const item of items) {
    context.settings.signal?.throwIfAborted();
    results.push(await verifyOne(childOf(item), role, context));
  }
  return results;
}

/** Runs the checks that need the credential to be authentic and that fetch what it names. */
async function followUp(authentic: Authentic, role: Role, context: Context): Promise<Checks> {
  const { clock, clockSkewSeconds } = context.settings;
  return {
    schema: await checkSchema(authentic, context),
    status: await checkStatus(authentic, context),
    validity: checkValidity(authentic.credential, authentic.timeFault, readClock(clock), clockSkewSeconds),
    recipient: recipientOf(authentic, role, context),
  };
}

/**
 * Verifies one credential as Open Badges 9 and CLR 8 say: its form, its proof and the issuer's hold on the key, then, for a
 * credential that is authentic, its refresh, its schema, its status, its validity and its recipient, then its endorsements and,
 * for a CLR, the credentials it holds. Each of those is verified as a credential in turn. Nothing that a credential names is
 * fetched before its proof is valid, and a refresh is followed once, the endorsements of an endorsement are not followed, and neither are the credentials that a held credential holds.
 *
 * @param prepared - The credential in a compact JWS or as an object.
 * @param role - Where the credential is in the verification.
 * @param context - What the call shares.
 */
export async function verifyOne(
  prepared: Parameters<typeof authenticate>[0],
  role: Role,
  context: Context,
): Promise<VerificationResult> {
  const { unavailable } = context.settings;
  const first = await authenticate(prepared, context);
  if (first.authentic === undefined) return resultOf(first.checks, unavailable);
  const stop = (checks: Checks, reason: string) =>
    resultOf({ ...checks, format: checkOf("format", "failed", reason) }, unavailable);
  const tooMany = overLimit(first.authentic, role, context);
  if (tooMany !== undefined) return stop(first.checks, tooMany);
  // The refresh is followed once, and what it gives takes the place of the credential for the rest.
  const refreshed = await refresh(first.authentic, context);
  const current = refreshed.replacement ?? first;
  const authentic = refreshed.replacement?.authentic ?? first.authentic;
  const refreshedTooMany = refreshed.replacement === undefined ? undefined : overLimit(authentic, role, context);
  if (refreshedTooMany !== undefined) return stop({ ...current.checks, refresh: refreshed.check }, refreshedTooMany);
  const checks: Checks = {
    ...current.checks,
    refresh: refreshed.check,
    ...(await followUp(authentic, role, context)),
  };
  const endorsements = await verifyEach(followedEndorsements(authentic, role), "endorsement", context);
  const held = role === "root" && authentic.kind === "clr" ? heldCredentialsOf(authentic.credential) : [];
  const nested = await verifyEach(held, "held", context);
  return resultOf(checks, unavailable, { credential: authentic.credential, endorsements, nested });
}
