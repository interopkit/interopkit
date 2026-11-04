import type { Issue } from "@interopkit/core/checks";

/** Makes a finding that is an error. */
export function error(path: string, rule: string, message: string): Issue {
  return { path, rule, message, severity: "error" };
}

/** Makes a finding that is a warning. */
export function warning(path: string, rule: string, message: string): Issue {
  return { path, rule, message, severity: "warning" };
}
