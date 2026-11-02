import type { Statement, StatementIssue } from "../model/index.js";
import { error } from "./finding.js";
import { identifierIssues } from "./identifiers.js";
import { interactionIssues } from "./interaction.js";
import type { RuleSet } from "./options.js";
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

/** The versions of a Statement that an LRS of 1.0.3 takes: `1.0` and `1.0.x` (1.0.3 Data 2.4.10, Communication 3.3). */
const VERSION_1_0 = /^1\.0(?:\.\d+)?$/u;

/**
 * Judges the `version` of a Statement for an LRS of 1.0.3, which rejects a version that does not start with `1.0` (1.0.3 Data
 * 2.4.10). An LRS of 2.0 should not reject a Statement for its version (4.2.4.2), and a provider has rules of its own.
 */
function versionIssues(statement: Statement): StatementIssue[] {
  const { version } = statement;
  if (version === undefined || VERSION_1_0.test(version)) return [];
  return [error("version", "invalid-value", `expected 1.0 or 1.0.x, found ${JSON.stringify(version)}.`)];
}

/**
 * Judges a Statement that has the shape of the model against the rules between its properties, for the rules of an LRS or of
 * a Learning Record Provider, in a version.
 *
 * @param statement - The Statement, read by the schema of the version.
 * @param rules - Whose rules apply, and of which version.
 * @param input - The Statement as it was given, for the rules that the reading changes: a single Activity of a context becomes a list.
 */
export function ruleIssues(statement: Statement, rules: RuleSet, input: unknown): StatementIssue[] {
  const issues: StatementIssue[] = [];
  const { role, version } = rules;
  const provider = role === "provider";
  walkStatement(statement, {
    statement(node, path) {
      issues.push(...relationIssues(node, path));
      if (provider) {
        issues.push(...providerTimeIssues(node, path, version));
        if (!isSubStatement(node)) issues.push(...providerStatementIssues(node, version));
      }
    },
    actor(node, path) {
      issues.push(...identifierIssues(node, path));
    },
    activity(node, path) {
      issues.push(...interactionIssues(node, path, rules));
    },
    result(node, path) {
      issues.push(...resultIssues(node, path));
      if (provider) issues.push(...providerResultIssues(node, path));
    },
  });
  if (version === "1.0.3" && !provider) issues.push(...versionIssues(statement));
  // 2.0 asks a provider to leave out an empty object (5.2.4.1); 1.0.3 asks it of every Statement (Data 2.2).
  if (provider || version === "1.0.3") issues.push(...emptyObjectIssues(statement));
  if (provider) issues.push(...singleActivityIssues(input, ""));
  return issues;
}
