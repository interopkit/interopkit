import { findingsOf } from "@interopkit/core/checks";
import * as v from "valibot";
import type { RuleRole, Statement, StatementIssue } from "../model/index.js";
import { ruleIssues } from "./rules.js";
import { statementSchema } from "./schemas.js";

/** What reading a value found: the Statement as the model has it when its shape is right, and every finding. */
export interface Inspection {
  /** The Statement, a copy that shares nothing with the input. It is there when the shape is right, whatever else is found. */
  readonly value?: Statement;
  /** Every finding, errors and warnings. */
  readonly issues: readonly StatementIssue[];
}

/** Reads a value into a Statement, and judges the rules between its properties when its shape is right. */
export function inspectStatement(input: unknown, role: RuleRole): Inspection {
  const result = v.safeParse(statementSchema, input);
  if (!result.success) {
    return { issues: findingsOf(result.issues).map((finding) => ({ ...finding, severity: "error" })) };
  }
  return { value: result.output, issues: ruleIssues(result.output, role, input) };
}

/** Returns the findings that are errors. */
export function errorsOf(issues: readonly StatementIssue[]): readonly StatementIssue[] {
  return issues.filter(({ severity }) => severity === "error");
}
