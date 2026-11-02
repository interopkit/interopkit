import type { CredentialIssue, IdentityObjectV2, ProfileV2, RevocationListV2 } from "../model/index.js";
import { isUrlV2, parseDateTimeV2 } from "./formats-v2.js";
import type { AssertionDocumentV2, BadgeClassDocumentV2 } from "./open-badges-v2-schemas.js";

/** The form of a hashed identity that Open Badges 2.0 names: `md5$` and 32 hexadecimal digits, or `sha256$` and 64. */
const IDENTITY_HASH = /^(?:md5\$[0-9a-fA-F]{32}|sha256\$[0-9a-fA-F]{64})$/u;

/** An address of an email as the validator of 1EdTech reads a plain identity of the type `email`. */
const EMAIL_IDENTITY = /^[^@]+@[^@]+$/u;

/** Joins a place and a path below it. */
function at(place: string, path: string): string {
  return place === "" ? path : `${place}.${path}`;
}

/**
 * Judges the recipient of an assertion (OB 2.0, IdentityObject): an identity that says it is hashed holds a hash of a form that
 * the specification names, one that says it is not holds no such hash, and a plain email is an address.
 *
 * @param identity - The recipient, as the schema read it.
 * @param place - Where the recipient is.
 */
function identityIssuesV2(identity: IdentityObjectV2, place: string): CredentialIssue[] {
  const path = at(place, "identity");
  const looksHashed = IDENTITY_HASH.test(identity.identity);
  if (identity.hashed && !looksHashed) {
    return [
      {
        path,
        rule: "identity-hash-form",
        message:
          'is said to be hashed and is not "sha256$" and 64 hexadecimal digits, or "md5$" and 32: hash the identity, or set hashed to false.',
        severity: "error",
      },
    ];
  }
  if (!identity.hashed && looksHashed) {
    return [
      {
        path,
        rule: "identity-hash-flag",
        message: "is a hash and hashed is false: set hashed to true, or give the plain identity.",
        severity: "error",
      },
    ];
  }
  if (!identity.hashed && identity.type === "email" && !EMAIL_IDENTITY.test(identity.identity)) {
    return [
      {
        path,
        rule: "identity-email-form",
        message: "is a plain identity of the type email and not an email address.",
        severity: "error",
      },
    ];
  }
  return [];
}

/**
 * Judges an assertion as a whole: its recipient, and an expiry that does not come before its issue.
 *
 * @param assertion - The assertion, as the schema read it.
 * @param place - Where the assertion is.
 */
export function assertionIssuesV2(assertion: AssertionDocumentV2, place: string): CredentialIssue[] {
  const issues = identityIssuesV2(assertion.recipient, at(place, "recipient"));
  const expires = assertion.expires === undefined ? undefined : parseDateTimeV2(assertion.expires);
  const issued = parseDateTimeV2(assertion.issuedOn);
  if (expires !== undefined && issued !== undefined && expires < issued) {
    issues.push({
      path: at(place, "expires"),
      rule: "expiry-before-issue",
      message: `is before issuedOn, ${assertion.issuedOn}: an assertion cannot expire before it was issued.`,
      severity: "error",
    });
  }
  return issues;
}

/**
 * Judges a BadgeClass as a whole: embedded criteria say what they are, by a page or a narrative.
 *
 * @param badge - The BadgeClass, as the schema read it.
 * @param place - Where the BadgeClass is.
 */
export function badgeClassIssuesV2(badge: BadgeClassDocumentV2, place: string): CredentialIssue[] {
  const { criteria } = badge;
  if (typeof criteria === "string" || criteria.id !== undefined || criteria.narrative !== undefined) return [];
  return [
    {
      path: at(place, "criteria"),
      rule: "criteria-undescribed",
      message: "has neither an id nor a narrative, so nothing says how to earn the badge: give it one of them.",
      severity: "error",
    },
  ];
}

/**
 * Judges the profile of the issuer of a badge: its `id` is an HTTP or HTTPS URL, which the verification of hosted assertions
 * and most platforms need.
 *
 * @param issuer - The profile, as the schema read it.
 * @param place - Where the profile is.
 */
export function issuerIssuesV2(issuer: ProfileV2, place: string): CredentialIssue[] {
  if (isUrlV2(issuer.id)) return [];
  return [
    {
      path: at(place, "id"),
      rule: "issuer-not-http",
      message:
        "is not an HTTP or HTTPS URL: the issuer is not hosted, so no origin bounds its hosted assertions and many platforms cannot read it.",
      severity: "warning",
    },
  ];
}

/**
 * Judges a revocation list: each entry that is an object names the assertion by its `id` or its `uid`.
 *
 * @param list - The revocation list, as the schema read it.
 * @param place - Where the list is.
 */
export function revocationListIssuesV2(list: RevocationListV2, place: string): CredentialIssue[] {
  const issues: CredentialIssue[] = [];
  for (const [index, entry] of list.revokedAssertions.entries()) {
    if (typeof entry === "string" || entry.id !== undefined || entry.uid !== undefined) continue;
    issues.push({
      path: `${at(place, "revokedAssertions")}[${index}]`,
      rule: "entry-unidentified",
      message: "has neither an id nor a uid, so it names no revoked assertion: give it one of them.",
      severity: "error",
    });
  }
  return issues;
}
