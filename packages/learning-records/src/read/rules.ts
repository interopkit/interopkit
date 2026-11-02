import type { FindingSink } from "@interopkit/core/checks";
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
 * a Learning Record Provider, in a version. The findings go to the sink as they are found, so that a value wrong in a million
 * places costs the memory of the limit.
 *
 * @param statement - The Statement, read by the schema of the version.
 * @param rules - Whose rules apply, and of which version.
 * @param input - The Statement as it was given, for the rules that the reading changes: a single Activity of a context becomes a list.
 * @param sink - Takes the findings.
 */
export function judgeRules(
  statement: Statement,
  rules: RuleSet,
  input: unknown,
  sink: FindingSink<StatementIssue>,
): void {
  const { role, version } = rules;
  const provider = role === "provider";
  walkStatement(statement, {
    statement(node, path) {
      sink.add(relationIssues(node, path));
      if (provider) {
        sink.add(providerTimeIssues(node, path, version));
        if (!isSubStatement(node)) sink.add(providerStatementIssues(node, version));
      }
    },
    actor(node, path) {
      sink.add(identifierIssues(node, path));
    },
    activity(node, path) {
      sink.add(interactionIssues(node, path, rules));
    },
    result(node, path) {
      sink.add(resultIssues(node, path));
      if (provider) sink.add(providerResultIssues(node, path));
    },
  });
  if (version === "1.0.3" && !provider) sink.add(versionIssues(statement));
  // 2.0 asks a provider to leave out an empty object (5.2.4.1); 1.0.3 asks it of every Statement (Data 2.2).
  if (provider || version === "1.0.3") sink.add(emptyObjectIssues(statement));
  if (provider) sink.add(singleActivityIssues(input, ""));
}
