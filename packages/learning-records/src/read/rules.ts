import type { RuleRole, Statement, StatementIssue } from "../model/index.js";
import { identifierIssues } from "./identifiers.js";
import { interactionIssues } from "./interaction.js";
import {
  emptyObjectIssues,
  providerResultIssues,
  providerStatementIssues,
  providerTimeIssues,
  singleActivityIssues,
} from "./provider.js";
import { relationIssues } from "./relations.js";
import { resultIssues } from "./results.js";
import { isSubStatement, walkStatement } from "./walk.js";

/**
 * Judges a Statement that has the shape of the model against the rules between its properties, for the rules of an LRS or of
 * a Learning Record Provider.
 *
 * @param statement - The Statement, read by the schema.
 * @param role - Whose rules apply.
 * @param input - The Statement as it was given, for the rules that the reading changes: a single Activity of a context becomes a list.
 */
export function ruleIssues(statement: Statement, role: RuleRole, input: unknown): StatementIssue[] {
  const issues: StatementIssue[] = [];
  const provider = role === "provider";
  walkStatement(statement, {
    statement(node, path) {
      issues.push(...relationIssues(node, path));
      if (provider) {
        issues.push(...providerTimeIssues(node, path));
        if (!isSubStatement(node)) issues.push(...providerStatementIssues(node));
      }
    },
    actor(node, path) {
      issues.push(...identifierIssues(node, path));
    },
    activity(node, path) {
      issues.push(...interactionIssues(node, path, role));
    },
    result(node, path) {
      issues.push(...resultIssues(node, path));
      if (provider) issues.push(...providerResultIssues(node, path));
    },
  });
  if (provider) issues.push(...emptyObjectIssues(statement), ...singleActivityIssues(input, ""));
  return issues;
}
