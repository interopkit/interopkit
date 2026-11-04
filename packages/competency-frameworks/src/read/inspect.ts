import { buildIssues, type IssueSink, safeParseBounded } from "@interopkit/core/checks";
import type { CaseEntity, CaseEntityKind, CasePackage, CaseVersion } from "../model/index.js";
import { entityIssues, packageIssues } from "./integrity.js";
import { packageFormIssues } from "./package-form.js";
import { SCHEMAS } from "./schemas.js";

/**
 * Reads a package of a version into a sink of findings, and checks its identifiers, links and tree when its shape is right. The
 * links that the form of a package lacks and a provider wrote all the same are warnings, and are left out of the package.
 *
 * @returns The package, a copy that shares nothing with the input, when its shape is right, whatever else is found.
 */
export function inspectPackage(value: unknown, version: CaseVersion, sink: IssueSink): CasePackage | undefined {
  const result = safeParseBounded(SCHEMAS[version].package, value, sink.room);
  if (!result.success) {
    sink.add(buildIssues(result.issues));
    return undefined;
  }
  sink.add(packageFormIssues(value));
  sink.add(packageIssues(result.output));
  return result.output;
}

/** Reads an entity of a kind and a version into a sink of findings, and checks its identifiers when its shape is right. */
export function inspectEntity(
  kind: CaseEntityKind,
  value: unknown,
  version: CaseVersion,
  sink: IssueSink,
): CaseEntity | undefined {
  const result = safeParseBounded(SCHEMAS[version].entities[kind], value, sink.room);
  if (!result.success) {
    sink.add(buildIssues(result.issues));
    return undefined;
  }
  sink.add(packageFormIssues(value));
  sink.add(entityIssues(result.output));
  return result.output;
}
