import { buildFindings } from "@interopkit/core/checks";
import type * as v from "valibot";
import type { CaseIssue } from "../model/index.js";

/** Turns the issues of a parse into findings that are all errors. */
export function toIssues(issues: readonly v.BaseIssue<unknown>[]): CaseIssue[] {
  return buildFindings(issues).map((finding) => ({ ...finding, severity: "error" }));
}
