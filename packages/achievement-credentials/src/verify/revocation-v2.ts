import type { BadgeAssertionV2, VerificationCheck } from "../model/index.js";
import { inspectDocumentV2, issueSink } from "../read/internal.js";
import type { Context } from "./context.js";
import { fetchDocumentV2 } from "./fetch-v2.js";
import { checkOf } from "./result.js";

/**
 * Checks that a signed 2.0 assertion is not revoked (Open Badges 2.0, SignedBadge Verification): its issuer's `revocationList`,
 * fetched once its signature verifies, does not name its `id`, or the `uid` of a badge before 1.1. An issuer that publishes no
 * list has revoked nothing.
 */
export async function checkRevocationList(
  { assertion, issuer }: BadgeAssertionV2,
  context: Context,
): Promise<VerificationCheck> {
  if (issuer.revocationList === undefined) {
    return checkOf("status", "passed", `The issuer ${issuer.id} publishes no revocation list.`);
  }
  const fetched = await fetchDocumentV2(issuer.revocationList, "The revocation list", context);
  if ("unavailable" in fetched) return checkOf("status", "unavailable", fetched.unavailable);
  if (!("document" in fetched)) {
    return checkOf("status", "unavailable", "failed" in fetched ? fetched.failed : "The revocation list is gone.");
  }
  const sink = issueSink(1000, true);
  const list = inspectDocumentV2("revocation-list", fetched.document, sink);
  if (list === undefined || sink.list().length > 0) {
    return checkOf("status", "unavailable", `The document at ${issuer.revocationList} is not a revocation list.`);
  }
  const entry = list.revokedAssertions.find((revoked) =>
    typeof revoked === "string"
      ? revoked === assertion.id
      : revoked.id === assertion.id || (assertion.uid !== undefined && revoked.uid === assertion.uid),
  );
  if (entry === undefined)
    return checkOf("status", "passed", "The revocation list of the issuer does not name the assertion.");
  const reason = typeof entry === "string" ? undefined : entry.revocationReason;
  return checkOf("status", "failed", `The issuer revoked the assertion${reason === undefined ? "." : `: ${reason}`}`);
}
