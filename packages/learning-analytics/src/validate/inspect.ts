import { buildIssues, copyJson, type FindingSink, type Issue, safeParseBounded } from "@interopkit/core/checks";
import type { CaliperEvent, CaliperVersion, EntityDocument } from "../model/index.js";
import { SCHEMA_SETS } from "../read/internal.js";
import { ADVISED, articled, missingProperties } from "./advised-properties.js";
import { eventFindings } from "./event-findings.js";
import { error } from "./finding.js";

/**
 * Copies a value that must be JSON, which also limits how deep it nests, and says in a finding where it is not. A value that
 * `JSON.parse` made of a request within the depth of `MAX_JSON_DEPTH` is JSON that nothing else holds, so it is read as it is.
 */
function copyOf(value: unknown, sink: FindingSink<Issue>, parsed: boolean): { readonly value: unknown } | undefined {
  if (parsed) return { value };
  const copy = copyJson(value, "");
  if (!("problem" in copy)) return { value: copy.value };
  sink.add([error("", "invalid-value", `${copy.problem}.`)]);
  return undefined;
}

/**
 * Reads an event into a sink of findings, and judges its profile when its shape is right and the version is 1.2: the tables of the
 * profiles are those of 1.2, and an event of 1.1 names no profile.
 *
 * @param parsed - Whether `JSON.parse` made the value of a request, so that it needs no copy.
 * @returns The event as the schema reads it, a copy that shares nothing with the input, when its shape is right.
 */
export function inspectEvent(
  value: unknown,
  sink: FindingSink<Issue>,
  version: CaliperVersion,
  parsed = false,
): CaliperEvent | undefined {
  const copy = copyOf(value, sink, parsed);
  if (copy === undefined) return undefined;
  const result = safeParseBounded(SCHEMA_SETS[version].event, copy.value, sink.room);
  if (!result.success) {
    sink.add(buildIssues(result.issues));
    return undefined;
  }
  if (version === "1.2") sink.add(eventFindings(result.output));
  return result.output;
}

/**
 * Reads an entity describe into a sink of findings, and judges the properties that Caliper advises when its shape is right.
 *
 * @param parsed - Whether `JSON.parse` made the value of a request, so that it needs no copy.
 * @returns The entity, with its `@context` first, when its shape is right.
 */
export function inspectEntity(
  value: unknown,
  sink: FindingSink<Issue>,
  version: CaliperVersion,
  parsed = false,
): EntityDocument | undefined {
  const copy = copyOf(value, sink, parsed);
  if (copy === undefined) return undefined;
  const { entity, entityDocument } = SCHEMA_SETS[version];
  const document = safeParseBounded(entityDocument, copy.value, sink.room);
  if (!document.success) {
    sink.add(buildIssues(document.issues));
    return undefined;
  }
  const { "@context": context, ...rest } = document.output;
  const result = safeParseBounded(entity, rest, sink.room);
  if (!result.success) {
    sink.add(buildIssues(result.issues));
    return undefined;
  }
  const described: EntityDocument = { "@context": context, ...result.output };
  const properties = version === "1.2" ? ADVISED.get(described.type) : undefined;
  if (properties !== undefined) sink.add(missingProperties(described, "", properties, articled(described.type)));
  return described;
}
