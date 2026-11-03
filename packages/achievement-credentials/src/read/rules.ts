import { isAbsoluteUri, isDateTime, isRecord, parseDateTime } from "@interopkit/core/checks";
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
  if (!isDateTime(from) || !isDateTime(until) || parseDateTime(from) <= parseDateTime(until)) return [];
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

/** Reads what a property holds as a list: its members, or none when it is absent. */
function listOf(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Reads the `id` of each object of a list that has one. */
function idsOf(values: readonly unknown[]): ReadonlySet<unknown> {
  return new Set(values.filter(isRecord).map(({ id }) => id));
}

/**
 * Judges the results of the subject of an achievement against the achievement (OB B.1.16): each result names a
 * ResultDescription of the achievement, its achieved level is a RubricCriterionLevel of that description, and a result of a
 * description of the type `Status` has a status. They are warnings: the official schemas do not check them, and the verifiers
 * in use report them without refusing the credential.
 *
 * @param subject - The subject, as the schemas read it.
 * @param path - Where the subject is.
 */
export function* resultIssues(subject: object, path: string): Generator<CredentialIssue> {
  const achievement: unknown = Reflect.get(subject, "achievement");
  const descriptions = isRecord(achievement) ? listOf(achievement.resultDescription).filter(isRecord) : [];
  for (const [index, result] of listOf(Reflect.get(subject, "result")).entries()) {
    if (!isRecord(result) || typeof result.resultDescription !== "string") continue;
    const at = `${path}.result[${index}]`;
    const linked = descriptions.find(({ id }) => id === result.resultDescription);
    if (linked === undefined) {
      yield {
        path: `${at}.resultDescription`,
        rule: "result-description-unknown",
        message: "is the id of no ResultDescription of the achievement, which the result must name.",
        severity: "warning",
      };
      continue;
    }
    if (
      typeof result.achievedLevel === "string" &&
      !idsOf(listOf(linked.rubricCriterionLevel)).has(result.achievedLevel)
    ) {
      yield {
        path: `${at}.achievedLevel`,
        rule: "achieved-level-unknown",
        message: "is the id of no RubricCriterionLevel of the ResultDescription that the result names.",
        severity: "warning",
      };
    }
    if (linked.resultType === "Status" && result.status === undefined) {
      yield {
        path: at,
        rule: "result-status-missing",
        message: "has no status, which a result of a ResultDescription of the type Status requires.",
        severity: "warning",
      };
    }
  }
}

/**
 * Judges the criteria of an achievement: they say what earns it, by the address of a page or a narrative. Open Badges 3.0
 * leaves both optional and the validator of 1EdTech refuses criteria that have neither, so it is a warning.
 *
 * @param achievement - The achievement, as the schemas read it.
 * @param path - Where the achievement is.
 */
export function* criteriaIssues(achievement: unknown, path: string): Generator<CredentialIssue> {
  const criteria = isRecord(achievement) ? achievement.criteria : undefined;
  if (!isRecord(criteria) || criteria.id !== undefined || criteria.narrative !== undefined) return;
  yield {
    path: path === "" ? "criteria" : `${path}.criteria`,
    rule: "criteria-undescribed",
    message: "has neither an id nor a narrative, so nothing says how to earn the achievement: give it one of them.",
    severity: "warning",
  };
}

/** Makes an error of a related resource. */
function relatedError(path: string, rule: string, message: string): CredentialIssue {
  return { path, rule, message, severity: "error" };
}

/** Judges one related resource: an object with an `id` that is an absolute URI and not that of another, and a digest. */
function* relatedEntryIssues(entry: unknown, at: string, seen: Set<string>): Generator<CredentialIssue> {
  if (!isRecord(entry)) {
    yield relatedError(at, "related-resource-form", "is not an object with the id and the digest of a resource.");
    return;
  }
  if (typeof entry.id !== "string" || !isAbsoluteUri(entry.id)) {
    yield relatedError(`${at}.id`, "related-resource-id", "must be the absolute URI of the resource.");
  } else if (seen.has(entry.id)) {
    yield relatedError(
      `${at}.id`,
      "related-resource-duplicate",
      "names a resource that another related resource names.",
    );
  } else {
    seen.add(entry.id);
  }
  if (typeof entry.digestSRI !== "string" && typeof entry.digestMultibase !== "string") {
    yield relatedError(at, "related-resource-digest", "has neither a digestSRI nor a digestMultibase of the resource.");
  }
}

/**
 * Judges the related resources of a credential of the Data Model 2.0 (5.3): one or more objects, each with an `id` that is an
 * absolute URI and is not that of another, and a `digestSRI` or a `digestMultibase` of the resource. The package carries the
 * property and fetches no resource that it names, so the digests themselves are not compared.
 *
 * @param credential - The credential, as the schemas read it.
 */
export function* relatedResourceIssues(credential: object): Generator<CredentialIssue> {
  const related: unknown = Reflect.get(credential, "relatedResource");
  if (related === undefined || "issuanceDate" in credential) return;
  const entries = listOf(related);
  if (entries.length === 0) {
    yield relatedError("relatedResource", "related-resource-form", "is empty, and it must hold one or more objects.");
  }
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    yield* relatedEntryIssues(entry, Array.isArray(related) ? `relatedResource[${index}]` : "relatedResource", seen);
  }
}
