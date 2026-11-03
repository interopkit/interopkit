import { readClock } from "@interopkit/core";
import { describeRefusal, isRecord } from "@interopkit/core/checks";
import type { BadgeAssertionV2, VerificationCheck, VerificationResult } from "../model/index.js";
import {
  DOCUMENT_PLACES,
  inspectBadgeV2,
  isBadgeAssertionV2,
  isDocumentV2,
  issueSink,
  readJwsPayload,
} from "../read/internal.js";
import { checkRecipientV2, checkValidityV2 } from "./checks-v2.js";
import type { Context } from "./context.js";
import { fetchDocumentV2, isHttpsAddress } from "./fetch-v2.js";
import type { Prepared } from "./input.js";
import { checkHostedPolicy, hostedIssuerCheck } from "./policy-v2.js";
import { type Checks, checkOf, resultOf } from "./result.js";
import { checkRevocationList } from "./revocation-v2.js";
import { checkSignature } from "./signature-v2.js";

type Json = Readonly<Record<string, unknown>>;

/** A badge of Open Badges 2.0 to verify: hosted at an address, or signed in a compact JWS whose payload is the assertion. */
export type BadgeV2Input =
  | { readonly verification: "hosted"; readonly address: unknown }
  | { readonly verification: "signed"; readonly jws: string; readonly assertion: Json }
  | { readonly reason: string };

/** Tells how an assertion says it is verified: the types of its `verification`, or of `verify`, the alias of that term. */
function verificationOf(assertion: Json): "hosted" | "signed" | undefined {
  const verification = assertion.verification ?? assertion.verify;
  const type = isRecord(verification) ? verification.type : undefined;
  const names = Array.isArray(type) ? type : [type];
  if (names.some((name) => name === "SignedBadge" || name === "signed")) return "signed";
  if (names.some((name) => name === "HostedBadge" || name === "hosted")) return "hosted";
  return undefined;
}

/** Why a signed assertion that is not in a JWS cannot be verified. */
const SIGNED_OUTSIDE_JWS =
  "says that it is signed and is not in a compact JWS: a signed badge is verified from its JWS, whose signature is outside the JSON.";

/** What an assertion that is not in a JWS is to a verification: hosted at its `id`, or a signed one without its signature. */
function objectInput(assertion: Json): BadgeV2Input {
  return verificationOf(assertion) === "signed"
    ? { reason: `The assertion ${SIGNED_OUTSIDE_JWS}` }
    : // The input is trusted only to name the address of the hosted assertion, which is the source of truth.
      { verification: "hosted", address: assertion.id };
}

/**
 * Tells whether a prepared input is an Open Badges 2.0 badge, and how it is verified: an assertion or a `BadgeAssertionV2` as an
 * object, or a compact JWS whose payload is under the context of Open Badges 2.0.
 *
 * @returns The badge to verify, or `undefined` when the input is a credential of Open Badges 3.0 or CLR 2.0.
 */
export function badgeV2InputOf(prepared: Prepared, context: Context): BadgeV2Input | undefined {
  if (prepared.form === "object") {
    const { value } = prepared;
    if (isBadgeAssertionV2(value) && isRecord(value.assertion)) return objectInput(value.assertion);
    return isDocumentV2(value) ? objectInput(value) : undefined;
  }
  const payload = readJwsPayload(prepared.jws, context.settings.jwt.maxTokens);
  if (!("value" in payload) || !isDocumentV2(payload.value)) return undefined;
  return verificationOf(payload.value) === "hosted"
    ? { reason: "The assertion in the JWS says that it is hosted: a hosted badge is verified at its address." }
    : { verification: "signed", jws: prepared.jws, assertion: payload.value };
}

/** What reading the documents of a badge gave: the badge, or the checks that say why there is none. */
type Assembled = { readonly badge: BadgeAssertionV2 } | { readonly checks: Checks };

/** The checks of a document that could not be fetched: the proof could not be made, or the badge cannot be read. */
function notFetched(fetched: { readonly failed: string } | { readonly unavailable: string } | { readonly gone: true }) {
  if ("unavailable" in fetched) return { checks: { proof: checkOf("proof", "unavailable", fetched.unavailable) } };
  const detail =
    "failed" in fetched ? fetched.failed : "The host answers 410 Gone for a document that the badge needs.";
  return { checks: { format: checkOf("format", "failed", detail) } };
}

/**
 * Has a document that another names: fetched from its HTTPS `id`, whose document is the source of truth, else the one that the
 * other embeds, which only a document with an `id` that is not HTTPS may be.
 *
 * @returns The IRI to name it by and the document fetched, or the document embedded as it is; or the checks of a failed fetch.
 */
async function linkedOf(
  reference: unknown,
  what: string,
  context: Context,
): Promise<
  { readonly address: string; readonly document: Json } | { readonly embedded: unknown } | { readonly checks: Checks }
> {
  const address = isRecord(reference) ? reference.id : reference;
  if (!isHttpsAddress(address)) return { embedded: reference };
  const fetched = await fetchDocumentV2(address, what, context);
  return "document" in fetched ? { address, document: fetched.document } : notFetched(fetched);
}

/**
 * Reads the assertion of a badge with its BadgeClass and issuer, each fetched from its HTTPS `id` when it has one, and joins the
 * three. A document fetched must have the `id` it was fetched at.
 */
async function assemble(assertion: Json, context: Context): Promise<Assembled> {
  const badge = await linkedOf(assertion.badge, "The BadgeClass", context);
  if ("checks" in badge) return badge;
  const badgeDocument = "document" in badge ? badge.document : badge.embedded;
  const issuer = await linkedOf(isRecord(badgeDocument) ? badgeDocument.issuer : undefined, "The issuer", context);
  if ("checks" in issuer) return issuer;
  // A document that is fetched is named by its address, so that the reader checks that it is the one named.
  const badgeRead =
    isRecord(badgeDocument) && "address" in issuer ? { ...badgeDocument, issuer: issuer.address } : badgeDocument;
  const assertionRead =
    "address" in badge ? { ...assertion, badge: badge.address } : { ...assertion, badge: badgeRead };
  const sink = issueSink(1000, true);
  const read = inspectBadgeV2(
    assertionRead,
    {
      ...("address" in badge ? { badge: badgeRead } : {}),
      ...("document" in issuer ? { issuer: issuer.document } : {}),
    },
    DOCUMENT_PLACES,
    sink,
  );
  const errors = sink.list();
  if (read === undefined || errors.length > 0) {
    return {
      checks: { format: checkOf("format", "failed", describeRefusal("The badge", errors, "validateCredential")) },
    };
  }
  return { badge: read };
}

const FORMAT_PASSED = (): VerificationCheck =>
  checkOf(
    "format",
    "passed",
    "The assertion, its BadgeClass and its issuer are documents of Open Badges 2.0 that the readers accept.",
  );

/** The checks that every verified 2.0 badge runs once it is authentic: none has a schema or a refresh, and each has a period and a recipient. */
function standingOf(badge: BadgeAssertionV2, context: Context): Checks {
  const { clock, clockSkewSeconds } = context.settings.jwt;
  return {
    schema: checkOf(
      "schema",
      "skipped",
      "Open Badges 2.0 names no JSON schema of a badge; the readers check its vocabulary.",
    ),
    refresh: checkOf("refresh", "skipped", "Open Badges 2.0 has no refresh service."),
    validity: checkValidityV2(badge.assertion, readClock(clock), clockSkewSeconds),
    recipient: checkRecipientV2(badge.assertion, context.settings.recipient),
  };
}

/** Verifies a hosted assertion: fetched at its address, revoked when its host says so, and within the policy of its issuer. */
async function verifyHosted(address: unknown, context: Context): Promise<VerificationResult> {
  const { unavailable } = context.settings;
  const fetched = await fetchDocumentV2(address, "The hosted assertion", context);
  if ("gone" in fetched) {
    return resultOf(
      {
        format: checkOf("format", "skipped", "The host answers 410 Gone, so there is no assertion to read."),
        status: checkOf("status", "failed", "The host of the assertion answers 410 Gone: its issuer revoked it."),
      },
      unavailable,
    );
  }
  if (!("document" in fetched)) return resultOf(notFetched(fetched).checks, unavailable);
  const hosted = fetched.document;
  if (hosted.revoked === true) {
    const reason = typeof hosted.revocationReason === "string" ? `: ${hosted.revocationReason}` : ".";
    return resultOf(
      { status: checkOf("status", "failed", `The host of the assertion marks it revoked${reason}`) },
      unavailable,
    );
  }
  if (hosted.id !== address) {
    const detail = `The assertion at ${String(address)} declares the id ${String(hosted.id)}: a hosted assertion is at its id.`;
    return resultOf({ proof: checkOf("proof", "failed", detail) }, unavailable);
  }
  if (verificationOf(hosted) === "signed") {
    return resultOf(
      { format: checkOf("format", "failed", `The assertion at ${address} ${SIGNED_OUTSIDE_JWS}`) },
      unavailable,
    );
  }
  const assembled = await assemble(hosted, context);
  if ("checks" in assembled) return resultOf(assembled.checks, unavailable);
  const { badge } = assembled;
  const issuer = checkHostedPolicy(badge);
  const checks: Checks = {
    format: FORMAT_PASSED(),
    proof: checkOf(
      "proof",
      "passed",
      "The assertion was fetched at its id, which is the source of truth of a hosted badge.",
    ),
    issuer,
  };
  if (issuer.outcome === "failed") return resultOf(checks, unavailable);
  const status = checkOf("status", "passed", "The host of the assertion does not mark it revoked.");
  return resultOf({ ...checks, ...standingOf(badge, context), status }, unavailable, { credential: badge });
}

/** Verifies a signed assertion: its signature by a key that its issuer lists, then the revocation list of the issuer. */
async function verifySigned(jws: string, assertion: Json, context: Context): Promise<VerificationResult> {
  const { unavailable } = context.settings;
  const assembled = await assemble(assertion, context);
  if ("checks" in assembled) return resultOf(assembled.checks, unavailable);
  const { badge } = assembled;
  const issuerOutside = hostedIssuerCheck(badge);
  if (issuerOutside !== undefined) return resultOf({ format: FORMAT_PASSED(), issuer: issuerOutside }, unavailable);
  const signature = await checkSignature(jws, badge, context);
  const checks: Checks = { format: FORMAT_PASSED(), ...signature };
  if (signature.proof?.outcome !== "passed" || signature.issuer?.outcome !== "passed")
    return resultOf(checks, unavailable);
  const status = await checkRevocationList(badge, context);
  return resultOf({ ...checks, ...standingOf(badge, context), status }, unavailable, { credential: badge });
}

/**
 * Verifies an Open Badges 2.0 badge as the Verification of Open Badges 2.0 and the validator of 1EdTech do: a hosted assertion
 * fetched at its `id` and within the verification policy of its issuer, or a signed assertion verified with a key that its
 * issuer lists and checked against the issuer's revocation list; then, for either, its validity and its recipient.
 *
 * @remarks
 * The BadgeClass and the issuer are fetched from their HTTPS `id`, whose documents are the source of truth, and read from what
 * the assertion embeds only when their `id` is not HTTPS; an issuer that is not at an HTTPS address fails the `issuer` check,
 * since nothing ties its keys or its policy to it. A signed assertion names the documents that hold its key, so its BadgeClass,
 * its issuer and its key are fetched before its signature is checked, and the revocation list after.
 */
export async function verifyBadgeV2(input: BadgeV2Input, context: Context): Promise<VerificationResult> {
  if ("reason" in input)
    return resultOf({ format: checkOf("format", "failed", input.reason) }, context.settings.unavailable);
  return input.verification === "hosted"
    ? await verifyHosted(input.address, context)
    : await verifySigned(input.jws, input.assertion, context);
}
