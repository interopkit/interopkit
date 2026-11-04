import type { Issue } from "@interopkit/core/checks";

/** Makes the finding of a requirement that the Statement breaks. */
export function error(path: string, rule: string, message: string): Issue {
  return { path, rule, message, severity: "error" };
}

/** Makes the finding of a recommendation that the Statement departs from. */
export function warning(path: string, rule: string, message: string): Issue {
  return { path, rule, message, severity: "warning" };
}
