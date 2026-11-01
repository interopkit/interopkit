import type { Result, StatementIssue } from "../model/index.js";
import { error } from "./finding.js";
import { member } from "./path.js";

/** The least and the greatest value of a scaled score (4.2.2.4). */
const SCALED_RANGE = [-1, 1] as const;

/** Makes the finding of a number outside the range that its property allows. */
function outOfRange(path: string, expected: string, found: number): StatementIssue {
  return error(path, "out-of-range", `expected ${expected}, found ${found}.`);
}

/**
 * Judges the score of a Result: `scaled` is from -1 to 1, `raw` is from `min` to `max` when they are present, and `min` is
 * less than `max` (4.2.2.4).
 */
export function resultIssues(result: Result, path: string): StatementIssue[] {
  const { score } = result;
  if (score === undefined) return [];
  const { scaled, raw, min, max } = score;
  const base = member(path, "score");
  const [least, greatest] = SCALED_RANGE;
  const issues: StatementIssue[] = [];
  if (scaled !== undefined && (scaled < least || scaled > greatest)) {
    issues.push(outOfRange(member(base, "scaled"), `a number from ${least} to ${greatest}`, scaled));
  }
  if (min !== undefined && max !== undefined && min >= max) {
    issues.push(outOfRange(member(base, "min"), `a number less than max, which is ${max}`, min));
  }
  if (raw !== undefined && min !== undefined && raw < min) {
    issues.push(outOfRange(member(base, "raw"), `a number of at least min, which is ${min}`, raw));
  }
  if (raw !== undefined && max !== undefined && raw > max) {
    issues.push(outOfRange(member(base, "raw"), `a number of at most max, which is ${max}`, raw));
  }
  return issues;
}
