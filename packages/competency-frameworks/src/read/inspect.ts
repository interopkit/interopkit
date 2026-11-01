import { createFindingSink, type FindingSink, safeParseBounded } from "@interopkit/core/checks";
import type { CaseEntity, CaseEntityKind, CaseIssue, CasePackage, CaseVersion } from "../model/index.js";
import { entityIssues, packageIssues } from "./integrity.js";
import { toIssues } from "./issues.js";
import { SCHEMAS } from "./schemas.js";

/**
 * Makes the list of findings of a call that stops at a limit. A reader keeps the errors alone, because it does not report
 * warnings, and a warning does not count toward the limit.
 */
export function issueSink(maxFindings: number, errorsOnly: boolean): FindingSink<CaseIssue> {
  return createFindingSink(
    maxFindings,
    (finding) => ({ ...finding, severity: "error" }),
    errorsOnly ? ({ severity }) => severity === "error" : undefined,
  );
}

/**
 * Reads a package of a version into a sink of findings, and checks its identifiers, links and tree when its shape is right.
 *
 * @returns The package, a copy that shares nothing with the input, when its shape is right, whatever else is found.
 */
export function inspectPackage(
  value: unknown,
  version: CaseVersion,
  sink: FindingSink<CaseIssue>,
): CasePackage | undefined {
  const result = safeParseBounded(SCHEMAS[version].package, value, sink.room);
  if (!result.success) {
    sink.add(toIssues(result.issues));
    return undefined;
  }
  sink.add(packageIssues(result.output));
  return result.output;
}

/** Reads an entity of a kind and a version into a sink of findings, and checks its identifiers when its shape is right. */
export function inspectEntity(
  kind: CaseEntityKind,
  value: unknown,
  version: CaseVersion,
  sink: FindingSink<CaseIssue>,
): CaseEntity | undefined {
  const result = safeParseBounded(SCHEMAS[version].entities[kind], value, sink.room);
  if (!result.success) {
    sink.add(toIssues(result.issues));
    return undefined;
  }
  sink.add(entityIssues(result.output));
  return result.output;
}
