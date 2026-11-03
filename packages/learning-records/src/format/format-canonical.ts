import { DataError } from "@interopkit/core";
import { DEFAULT_MAX_FINDINGS, describeRefusal } from "@interopkit/core/checks";
import type { Activity, ActivityDefinition, Verb } from "../model/index.js";
import { inspectStatement, issueSink } from "../read/internal.js";
import { definitionInOneLanguage, oneLanguage } from "./language.js";
import type { Mappers } from "./transform.js";

/** Reads the canonical definition of an Activity, which a host gave, with the checks of a Statement whose Object it is. */
function checkedDefinition(id: string, definition: unknown): ActivityDefinition | undefined {
  const sink = issueSink(DEFAULT_MAX_FINDINGS, true);
  const value = inspectStatement(
    {
      actor: { mbox: "mailto:probe@example.org" },
      verb: { id: "https://example.org/probe" },
      object: { id, definition },
    },
    { role: "lrs", version: "2.0.0" },
    sink,
  );
  const errors = sink.list();
  if (value === undefined || errors.length > 0) {
    throw new DataError(
      describeRefusal(`The definition of ${JSON.stringify(id)} in the option activities`, errors, "validateStatement"),
    );
  }
  return "definition" in value.object ? value.object.definition : undefined;
}

/**
 * The changes of the format `canonical`: Activities with their canonical definition, and every language map of an Activity and
 * of a Verb cut to one language (4.1.6.1). Agents and Groups are returned as they are.
 */
export function canonicalMappers(
  activities: ReadonlyMap<string, ActivityDefinition>,
  languages: readonly string[],
): Mappers {
  const activity = (original: Activity): Activity => {
    const canonical = activities.has(original.id)
      ? checkedDefinition(original.id, activities.get(original.id))
      : original.definition;
    return canonical === undefined
      ? original
      : { ...original, definition: definitionInOneLanguage(canonical, languages) };
  };
  const verb = (original: Verb): Verb =>
    original.display === undefined ? original : { ...original, display: oneLanguage(original.display, languages) };
  return { agent: (agent) => agent, group: (group) => group, activity, verb };
}
