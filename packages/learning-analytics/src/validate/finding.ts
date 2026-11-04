import { createFindingSink, type FindingSink, type Issue } from "@interopkit/core/checks";

/** Makes a finding that is an error. */
export function error(path: string, rule: string, message: string): Issue {
  return { path, rule, message, severity: "error" };
}

/** Makes a finding that is a warning. */
export function warning(path: string, rule: string, message: string): Issue {
  return { path, rule, message, severity: "warning" };
}

/** Makes the list of findings of a call, which stops at a limit and ends with a finding that says so. */
export function findingSink(maxFindings: number): FindingSink<Issue> {
  return createFindingSink(maxFindings, (finding) => ({ ...finding, severity: "error" }));
}
