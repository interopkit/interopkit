import { createFindingSink, type FindingSink, findingsOf, safeParseBounded } from "@interopkit/core/checks";
import type { Statement, StatementIssue } from "../model/index.js";
import type { RuleSet } from "./options.js";
import { judgeRules } from "./rules.js";
import { STATEMENT_SCHEMAS } from "./schemas.js";

/**
 * Makes the list of findings of a call that stops at a limit. A reader keeps the errors alone, because it does not report
 * warnings, and a warning does not count toward the limit.
 */
export function issueSink(maxFindings: number, errorsOnly: boolean): FindingSink<StatementIssue> {
  return createFindingSink(
    maxFindings,
    (finding) => ({ ...finding, severity: "error" }),
    errorsOnly ? ({ severity }) => severity === "error" : undefined,
  );
}

/**
 * Reads a value into a Statement by the rules of a role and a version, and judges the rules between its properties when its
 * shape is right.
 *
 * @returns The Statement, a copy that shares nothing with the input, when its shape is right, whatever else is found.
 */
export function inspectStatement(
  input: unknown,
  rules: RuleSet,
  sink: FindingSink<StatementIssue>,
): Statement | undefined {
  const result = safeParseBounded(STATEMENT_SCHEMAS[rules.version], input, sink.room);
  if (!result.success) {
    sink.add(findingsOf(result.issues).map((finding) => ({ ...finding, severity: "error" })));
    return undefined;
  }
  judgeRules(result.output, rules, input, sink);
  return result.output;
}
