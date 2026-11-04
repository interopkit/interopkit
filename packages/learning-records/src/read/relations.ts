import type { Issue } from "@interopkit/core/checks";
import type { Statement, SubStatement } from "../model/index.js";
import { VERB_VOIDED } from "../model/index.js";
import { error, warning } from "./finding.js";
import { member } from "./path.js";
import { isSubStatement, objectKind } from "./walk.js";

/** The digit of a UUID that holds its variant: the first of the fourth group of 8-4-4-4-12. */
const VARIANT_DIGIT = 19;

/** The variants of RFC 4122, `10xx`, whose digit is 8, 9, a or b; xAPI asks for variant 2 (4.2.7). */
const RFC_4122_VARIANT = /[89abAB]/u;

/** Judges a UUID: it should be of variant 2 of RFC 4122 (4.2.7). */
function variantIssues(uuid: string | undefined, path: string): Issue[] {
  if (uuid === undefined || RFC_4122_VARIANT.test(uuid.charAt(VARIANT_DIGIT))) return [];
  return [
    warning(
      path,
      "uuid-variant",
      `expected a UUID of variant 2 of RFC 4122, whose fourth group starts with 8, 9, a or b, found ${JSON.stringify(uuid)}.`,
    ),
  ];
}

/** The most and the fewest Agents of an authority that is a Group: the Agent of the application and the Agent of the user. */
const AUTHORITY_MEMBERS = 2;

/** Judges the authority of a Statement: an Agent, or an anonymous Group of exactly two Agents, as an OAuth consumer and its user are written. */
function authorityIssues(statement: Statement, path: string): Issue[] {
  const { authority } = statement;
  if (authority?.objectType !== "Group") return [];
  const identified = [authority.mbox, authority.mbox_sha1sum, authority.openid, authority.account].some(
    (identifier) => identifier !== undefined,
  );
  if (!identified && authority.member?.length === AUTHORITY_MEMBERS) return [];
  return [
    error(
      member(path, "authority"),
      "authority-group",
      `expected an Agent, or an anonymous Group of exactly two Agents, found ${identified ? "an identified Group" : `an anonymous Group of ${authority.member?.length ?? 0} Agents`}.`,
    ),
  ];
}

/**
 * Judges the `revision` and `platform` of a context: they describe an Activity, so a Statement whose Object is another kind
 * does not have them.
 */
function contextIssues(statement: Statement | SubStatement, path: string): Issue[] {
  const { context } = statement;
  if (objectKind(statement.object) === "Activity") return [];
  return (["revision", "platform"] as const).flatMap((name) =>
    context?.[name] === undefined
      ? []
      : [
          error(
            member(member(path, "context"), name),
            "context-needs-activity",
            `expected no ${name}, which describes an Activity, in a Statement whose object is of type ${objectKind(statement.object)}.`,
          ),
        ],
  );
}

/**
 * Judges the properties of a Statement or a SubStatement that depend on each other: the Verb that voids has a Statement
 * Reference as its Object (4.2.5), the `revision` and `platform` of a context go with an Activity, the authority is an Agent or
 * an anonymous Group of two Agents, and the UUIDs should be of variant 2 (4.2.7).
 */
export function relationIssues(statement: Statement | SubStatement, path: string): Issue[] {
  const issues: Issue[] = [];
  if (statement.verb.id === VERB_VOIDED && statement.object.objectType !== "StatementRef") {
    issues.push(
      error(
        member(path, "object"),
        "voiding-target",
        `expected a Statement Reference to the Statement that the verb voids, found an object of type ${objectKind(statement.object)}.`,
      ),
    );
  }
  const { context } = statement;
  return [
    ...issues,
    ...contextIssues(statement, path),
    ...(isSubStatement(statement)
      ? []
      : [...authorityIssues(statement, path), ...variantIssues(statement.id, member(path, "id"))]),
    ...(statement.object.objectType === "StatementRef"
      ? variantIssues(statement.object.id, member(member(path, "object"), "id"))
      : []),
    ...variantIssues(context?.registration, member(member(path, "context"), "registration")),
    ...variantIssues(context?.statement?.id, member(member(member(path, "context"), "statement"), "id")),
  ];
}
