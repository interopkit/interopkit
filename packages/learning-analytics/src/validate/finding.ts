import { createFindingSink, type Finding, type FindingSink } from "@interopkit/core/checks";

/** One finding of `validateEvent` and `validateEntity`: where, which rule, what is wrong, and how serious it is. */
export interface CaliperFinding extends Finding {
  /** `error` for what Caliper requires or what no reading can use; `warning` for what Caliper recommends or the certification guide alone allows. */
  readonly severity: "error" | "warning";
}

/** Makes a finding that is an error. */
export function error(path: string, rule: string, message: string): CaliperFinding {
  return { path, rule, message, severity: "error" };
}

/** Makes a finding that is a warning. */
export function warning(path: string, rule: string, message: string): CaliperFinding {
  return { path, rule, message, severity: "warning" };
}

/** Makes the list of findings of a call, which stops at a limit and ends with a finding that says so. */
export function findingSink(maxFindings: number): FindingSink<CaliperFinding> {
  return createFindingSink(maxFindings, (finding) => ({ ...finding, severity: "error" }));
}
