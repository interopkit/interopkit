import type { Statement, StatementIssue, SubStatement } from "../model/index.js";
import { VERB_VOIDED } from "../model/index.js";
import { error, warning } from "./finding.js";
import { member } from "./path.js";
import { isSubStatement, objectKind } from "./walk.js";

/** The digit of a UUID that holds its variant: the first of the fourth group of 8-4-4-4-12. */
const VARIANT_DIGIT = 19;

/** The variants of RFC 4122, `10xx`, whose digit is 8, 9, a or b; xAPI asks for variant 2 (4.2.7). */
const RFC_4122_VARIANT = /[89abAB]/u;

/** Judges a UUID: it should be of variant 2 of RFC 4122 (4.2.7). */
function variantIssues(uuid: string | undefined, path: string): StatementIssue[] {
  if (uuid === undefined || RFC_4122_VARIANT.test(uuid.charAt(VARIANT_DIGIT))) return [];
  return [
    warning(
      path,
      "uuid-variant",
      `expected a UUID of variant 2 of RFC 4122, whose fourth group starts with 8, 9, a or b, found ${JSON.stringify(uuid)}.`,
    ),
  ];
}

/**
 * Judges the properties of a Statement or a SubStatement that depend on each other: the Verb that voids has a Statement
 * Reference as its Object (4.2.5), and the UUIDs should be of variant 2 (4.2.7).
 */
export function relationIssues(statement: Statement | SubStatement, path: string): StatementIssue[] {
  const issues: StatementIssue[] = [];
  if (statement.verb.id === VERB_VOIDED && statement.object.objectType !== "StatementRef") {
    issues.push(
      error(
        member(path, "object"),
        "voiding-target",
        `expected a Statement Reference to the Statement that the verb voids, found an object of type ${objectKind(statement.object)}.`,
      ),
    );
  }
  if (!isSubStatement(statement)) issues.push(...variantIssues(statement.id, member(path, "id")));
  if (statement.object.objectType === "StatementRef") {
    issues.push(...variantIssues(statement.object.id, member(member(path, "object"), "id")));
  }
  const { context } = statement;
  issues.push(...variantIssues(context?.registration, member(member(path, "context"), "registration")));
  issues.push(...variantIssues(context?.statement?.id, member(member(member(path, "context"), "statement"), "id")));
  return issues;
}
