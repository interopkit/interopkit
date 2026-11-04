import { buildFindings, type Issue } from "@interopkit/core/checks";
import type * as v from "valibot";

/** Turns the issues of a parse into findings that are all errors. */
export function toIssues(issues: readonly v.BaseIssue<unknown>[]): Issue[] {
  return buildFindings(issues).map((finding) => ({ ...finding, severity: "error" }));
}
