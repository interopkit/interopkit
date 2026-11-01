import * as v from "valibot";
import type { CaseEntity, CaseEntityKind, CaseIssue, CasePackage, CaseVersion } from "../model/index.js";
import { entityIssues, packageIssues } from "./integrity.js";
import { toIssues } from "./issues.js";
import { SCHEMAS } from "./schemas.js";

/** What reading a value found: the value as the model has it when its shape is right, and every finding. */
export interface Inspection<TValue> {
  /** The value, a copy that shares nothing with the input. It is there when the shape is right, whatever else is found. */
  readonly value?: TValue;
  /** Every finding, errors and warnings. */
  readonly issues: readonly CaseIssue[];
}

/** Reads a package of a version, and checks its identifiers, links and tree when its shape is right. */
export function inspectPackage(value: unknown, version: CaseVersion): Inspection<CasePackage> {
  const result = v.safeParse(SCHEMAS[version].package, value);
  if (!result.success) return { issues: toIssues(result.issues) };
  return { value: result.output, issues: packageIssues(result.output) };
}

/** Reads an entity of a kind and a version, and checks its identifiers when its shape is right. */
export function inspectEntity(kind: CaseEntityKind, value: unknown, version: CaseVersion): Inspection<CaseEntity> {
  const result = v.safeParse(SCHEMAS[version].entities[kind], value);
  if (!result.success) return { issues: toIssues(result.issues) };
  return { value: result.output, issues: entityIssues(result.output) };
}

/** Returns the findings that are errors. */
export function errorsOf(issues: readonly CaseIssue[]): readonly CaseIssue[] {
  return issues.filter(({ severity }) => severity === "error");
}

/**
 * Writes the sentence of the `DataError` that a refused value gives: the first error with its path, and how many more
 * there are.
 *
 * @param label - Names the value, such as `The package`.
 * @param errors - The errors, which are not empty when the shape is wrong.
 * @param validator - The function that lists every finding, such as `validatePackage`.
 */
export function refusal(label: string, errors: readonly CaseIssue[], validator: string): string {
  const [first, ...others] = errors;
  const where = first === undefined || first.path === "" ? "" : ` at ${first.path}`;
  const count = others.length === 1 ? "1 more error" : `${others.length} more errors`;
  const more = others.length === 0 ? "" : ` ${count}: ${validator} lists every finding.`;
  return `${label} is invalid${where}: ${first?.message ?? "it has an error."}${more}`;
}
