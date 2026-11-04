import { buildIssues, type IssueSink, safeParseBounded } from "@interopkit/core/checks";
import type { Statement } from "../model/index.js";
import type { RuleSet } from "./options.js";
import { judgeRules } from "./rules.js";
import { STATEMENT_SCHEMAS } from "./schemas.js";

/**
 * Reads a value into a Statement by the rules of a role and a version, and judges the rules between its properties when its
 * shape is right.
 *
 * @returns The Statement, a copy that shares nothing with the input, when its shape is right, whatever else is found.
 */
export function inspectStatement(input: unknown, rules: RuleSet, sink: IssueSink): Statement | undefined {
  const result = safeParseBounded(STATEMENT_SCHEMAS[rules.version], input, sink.room);
  if (!result.success) {
    sink.add(buildIssues(result.issues));
    return undefined;
  }
  judgeRules(result.output, rules, input, sink);
  return result.output;
}
