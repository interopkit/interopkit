import { parseDateTime } from "@interopkit/core/checks";
import type { CredentialIssue, IdentityObject } from "../model/index.js";

/** The form of an `IdentityHash` that the specification names: `sha256$` and 64 hexadecimal digits, or `md5$` and 32 (OB B.7). */
const IDENTITY_HASH = /^(?:sha256\$[0-9a-fA-F]{64}|md5\$[0-9a-fA-F]{32})$/u;

/** What the subject of a credential holds that says who it is. */
interface Identified {
  readonly id?: string;
  readonly identifier?: readonly IdentityObject[];
}

/**
 * Judges the subject of an achievement or a CLR: it has an `id` or at least one `identifier` (OB B.1.3, CLR B.1.2), and
 * every identifier that says it is hashed holds a hash in a form the specification names.
 *
 * @param subject - The subject, as the schemas read it.
 * @param path - Where the subject is.
 */
export function subjectIssues(subject: Identified, path: string): CredentialIssue[] {
  const issues: CredentialIssue[] = [];
  const at = (name: string) => (path === "" ? name : `${path}.${name}`);
  if (subject.id === undefined && (subject.identifier === undefined || subject.identifier.length === 0)) {
    issues.push({
      path,
      rule: "subject-unidentified",
      message: "has neither an id nor an identifier, so nothing says who earned it: give it one of them.",
      severity: "error",
    });
  }
  for (const [index, identity] of (subject.identifier ?? []).entries()) {
    if (identity.hashed && !IDENTITY_HASH.test(identity.identityHash)) {
      issues.push({
        path: `${at("identifier")}[${index}].identityHash`,
        rule: "identity-hash-form",
        message:
          'is said to be hashed and is not "sha256$" and 64 hexadecimal digits, or "md5$" and 32: hash the identity with hashIdentifier.',
        severity: "warning",
      });
    }
  }
  return issues;
}

/**
 * Judges the validity period of a credential: it does not end before it begins (Verifiable Credentials Data Model 2.0 4.9,
 * and 1.1 for `issuanceDate` and `expirationDate`). The two times are compared as instants, so an offset does not matter.
 *
 * @param credential - The credential, as the schemas read it.
 */
export function periodIssues(credential: object): CredentialIssue[] {
  const [begins, ends] = "validFrom" in credential ? ["validFrom", "validUntil"] : ["issuanceDate", "expirationDate"];
  const [from, until] = [Reflect.get(credential, begins ?? ""), Reflect.get(credential, ends ?? "")];
  if (typeof from !== "string" || typeof until !== "string") return [];
  const [start, end] = [parseDateTime(from), parseDateTime(until)];
  if (start === undefined || end === undefined || start <= end) return [];
  return [
    {
      path: ends ?? "",
      rule: "validity-period",
      message: `is earlier than ${begins}: a credential cannot end before it begins.`,
      severity: "error",
    },
  ];
}

/**
 * Judges the subject of a credential of no class of Open Badges or CLR: it says something, which is an `id` or any claim
 * (Verifiable Credentials Data Model 2.0 4.8: each subject is the subject of one or more claims).
 *
 * @param subject - The subject, as the schemas read it.
 */
export function emptySubjectIssues(subject: object): CredentialIssue[] {
  return Object.keys(subject).length > 0
    ? []
    : [
        {
          path: "credentialSubject",
          rule: "subject-empty",
          message: "has no property, so it is the subject of no claim: give it an id or a claim.",
          severity: "error",
        },
      ];
}
