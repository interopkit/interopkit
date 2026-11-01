import { createFindingSink, type FindingSink, findingsOf, safeParseBounded } from "@interopkit/core/checks";
import type { RuleRole, Statement, StatementIssue } from "../model/index.js";
import { ruleIssues } from "./rules.js";
import { statementSchema } from "./schemas.js";

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
 * Reads a value into a Statement, and judges the rules between its properties when its shape is right.
 *
 * @returns The Statement, a copy that shares nothing with the input, when its shape is right, whatever else is found.
 */
export function inspectStatement(
  input: unknown,
  role: RuleRole,
  sink: FindingSink<StatementIssue>,
): Statement | undefined {
  const result = safeParseBounded(statementSchema, input, sink.room);
  if (!result.success) {
    sink.add(findingsOf(result.issues).map((finding) => ({ ...finding, severity: "error" })));
    return undefined;
  }
  sink.add(ruleIssues(result.output, role, input));
  return result.output;
}
