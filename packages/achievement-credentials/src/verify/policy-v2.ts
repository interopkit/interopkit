import type { BadgeAssertionV2, VerificationCheck } from "../model/index.js";
import { isHttpsAddress } from "./fetch-v2.js";
import { checkOf } from "./result.js";

/** The authority of an address: its host and, when it names one, its port, as an allowed origin names it. */
function authorityOf(address: string): string {
  const { host } = new URL(address);
  return host;
}

/**
 * Checks that the issuer of a 2.0 badge is hosted at an HTTPS address: only then does anything bind its keys and its policy to
 * it, since a profile with another kind of id is written by whoever writes the badge.
 */
export function hostedIssuerCheck({ issuer }: BadgeAssertionV2): VerificationCheck | undefined {
  return isHttpsAddress(issuer.id)
    ? undefined
    : checkOf(
        "issuer",
        "failed",
        `The issuer ${issuer.id} is not at an HTTPS address, so nothing ties its keys or its verification policy to it.`,
      );
}

/** Writes an address as `URL` resolves it, which is the address that a fetch requests: without its dot segments, written or escaped. */
function resolved(address: string): string {
  return new URL(address).href;
}

/**
 * Checks that a hosted assertion is within the verification policy of its issuer (Open Badges 2.0, HostedBadge Verification,
 * as `verification.py` of the validator of 1EdTech applies it): its `id` starts with one of `startsWith` when the policy names
 * any, and its authority is one of `allowedOrigins`, which is the authority of the issuer's `id` when the policy names none. The
 * property of the policy is `id`, the only one that Open Badges 2.0 supports.
 *
 * @remarks
 * The `id` and each `startsWith` are compared as `URL` resolves them, which is the address that the assertion was fetched at:
 * written as it is, `/acme/../other/1` starts with `/acme/` and is served from `/other/1`, the path that a policy keeps out.
 */
export function checkHostedPolicy(badge: BadgeAssertionV2): VerificationCheck {
  const issuerOutside = hostedIssuerCheck(badge);
  if (issuerOutside !== undefined) return issuerOutside;
  const { assertion, issuer } = badge;
  const policy = issuer.verification ?? {};
  const failed = (detail: string) => checkOf("issuer", "failed", detail);
  if (policy.verificationProperty !== undefined && policy.verificationProperty !== "id") {
    return failed(
      `The verification policy of the issuer names the property ${policy.verificationProperty}; only id is supported.`,
    );
  }
  const { startsWith } = policy;
  if (startsWith !== undefined && !startsWith.some((prefix) => resolved(assertion.id).startsWith(resolved(prefix)))) {
    return failed(
      `The assertion ${assertion.id} does not start with any address that the policy of its issuer allows.`,
    );
  }
  const origins = policy.allowedOrigins ?? [authorityOf(issuer.id)];
  if (!isHttpsAddress(assertion.id) || !origins.includes(authorityOf(assertion.id))) {
    return failed(
      `The assertion ${assertion.id} is not hosted on an origin that its issuer allows: ${origins.join(", ")}.`,
    );
  }
  return checkOf(
    "issuer",
    "passed",
    `The assertion is hosted within the verification policy of its issuer ${issuer.id}.`,
  );
}
