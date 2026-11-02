import { copyJson, type FindingSink, findingsOf, safeParseBounded } from "@interopkit/core/checks";
import type * as v from "valibot";
import type { CaliperEvent, EntityDocument } from "../model/index.js";
import { entityDocumentSchema, entitySchema, eventSchema } from "../read/internal.js";
import { ADVISED, missingProperties } from "./advised-properties.js";
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
 * Reads an event into a sink of findings, and judges its profile when its shape is right.
 *
 * @returns The event as the schema reads it, a copy that shares nothing with the input, when its shape is right.
 */
export function inspectEvent(value: unknown, sink: FindingSink<CaliperFinding>): CaliperEvent | undefined {
  const copy = copyOf(value, sink);
  if (copy === undefined) return undefined;
  const result = safeParseBounded(eventSchema, copy.value, sink.room);
  if (!result.success) {
    sink.add(shapeFindings(result.issues));
    return undefined;
  }
  sink.add(eventFindings(result.output));
  return result.output;
}

/**
 * Reads an entity describe into a sink of findings, and judges the properties that Caliper advises when its shape is right.
 *
 * @returns The entity, with its `@context` first, when its shape is right.
 */
export function inspectEntity(value: unknown, sink: FindingSink<CaliperFinding>): EntityDocument | undefined {
  const copy = copyOf(value, sink);
  if (copy === undefined) return undefined;
  const document = safeParseBounded(entityDocumentSchema, copy.value, sink.room);
  if (!document.success) {
    sink.add(shapeFindings(document.issues));
    return undefined;
  }
  const { "@context": context, ...rest } = document.output;
  const result = safeParseBounded(entitySchema, rest, sink.room);
  if (!result.success) {
    sink.add(shapeFindings(result.issues));
    return undefined;
  }
  const entity: EntityDocument = { "@context": context, ...result.output };
  const properties = ADVISED.get(entity.type);
  if (properties !== undefined) sink.add(missingProperties(entity, "", properties, `a ${entity.type}`));
  return entity;
}
