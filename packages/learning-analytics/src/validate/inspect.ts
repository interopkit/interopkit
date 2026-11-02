import { copyJson, type FindingSink, findingsOf, safeParseBounded } from "@interopkit/core/checks";
import type * as v from "valibot";
import type { CaliperEvent, CaliperVersion, EntityDocument } from "../model/index.js";
import { SCHEMA_SETS } from "../read/internal.js";
import { ADVISED, articled, missingProperties } from "./advised-properties.js";
import { eventFindings } from "./event-findings.js";
import { type CaliperFinding, error } from "./finding.js";

/** Turns the issues of a parse into findings that are all errors. */
function shapeFindings(issues: readonly v.BaseIssue<unknown>[]): CaliperFinding[] {
  return findingsOf(issues).map((finding) => ({ ...finding, severity: "error" }));
}

/** Copies a value that must be JSON, which also limits how deep it nests, and says in a finding where it is not. */
function copyOf(value: unknown, sink: FindingSink<CaliperFinding>): { readonly value: unknown } | undefined {
  const copy = copyJson(value, "");
  if (!("problem" in copy)) return { value: copy.value };
  sink.add([error("", "invalid-value", `${copy.problem}.`)]);
  return undefined;
}

/**
 * Reads an event into a sink of findings, and judges its profile when its shape is right and the version is 1.2: the tables of the
 * profiles are those of 1.2, and an event of 1.1 names no profile.
 *
 * @returns The event as the schema reads it, a copy that shares nothing with the input, when its shape is right.
 */
export function inspectEvent(
  value: unknown,
  sink: FindingSink<CaliperFinding>,
  version: CaliperVersion,
): CaliperEvent | undefined {
  const copy = copyOf(value, sink);
  if (copy === undefined) return undefined;
  const result = safeParseBounded(SCHEMA_SETS[version].event, copy.value, sink.room);
  if (!result.success) {
    sink.add(shapeFindings(result.issues));
    return undefined;
  }
  if (version === "1.2") sink.add(eventFindings(result.output));
  return result.output;
}

/**
 * Reads an entity describe into a sink of findings, and judges the properties that Caliper advises when its shape is right.
 *
 * @returns The entity, with its `@context` first, when its shape is right.
 */
export function inspectEntity(
  value: unknown,
  sink: FindingSink<CaliperFinding>,
  version: CaliperVersion,
): EntityDocument | undefined {
  const copy = copyOf(value, sink);
  if (copy === undefined) return undefined;
  const { entity, entityDocument } = SCHEMA_SETS[version];
  const document = safeParseBounded(entityDocument, copy.value, sink.room);
  if (!document.success) {
    sink.add(shapeFindings(document.issues));
    return undefined;
  }
  const { "@context": context, ...rest } = document.output;
  const result = safeParseBounded(entity, rest, sink.room);
  if (!result.success) {
    sink.add(shapeFindings(result.issues));
    return undefined;
  }
  const described: EntityDocument = { "@context": context, ...result.output };
  const properties = version === "1.2" ? ADVISED.get(described.type) : undefined;
  if (properties !== undefined) sink.add(missingProperties(described, "", properties, articled(described.type)));
  return described;
}
