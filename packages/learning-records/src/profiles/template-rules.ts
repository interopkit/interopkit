import type { Issue } from "@interopkit/core/checks";
import { error, item, member } from "../read/internal.js";
import { parseJsonPath } from "./json-path.js";
import { findConcept, type ProfileReferences } from "./references.js";
import type { StatementTemplate, StatementTemplateRule } from "./templates.js";

/** The Determining Properties that name concepts, with the type of concept each names. */
const DETERMINING = [
  ["verb", "Verb"],
  ["objectActivityType", "ActivityType"],
  ["contextGroupingActivityType", "ActivityType"],
  ["contextParentActivityType", "ActivityType"],
  ["contextOtherActivityType", "ActivityType"],
  ["contextCategoryActivityType", "ActivityType"],
  ["attachmentUsageType", "AttachmentUsageType"],
] as const;

/** Says why a JSONPath of a rule is not one, or returns `undefined`. */
function jsonPathProblem(text: string): string | undefined {
  try {
    parseJsonPath(text);
    return undefined;
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

/** Judges a rule of a template: it asks something of the values, and its paths are JSONPaths that a rule may use. */
function* ruleIssues(rule: StatementTemplateRule, path: string): Generator<Issue> {
  if (rule.presence === undefined && rule.any === undefined && rule.all === undefined && rule.none === undefined) {
    yield error(path, "rule-requirement", "expected at least one of presence, any, all and none.");
  }
  for (const name of ["location", "selector"] as const) {
    const text = rule[name];
    const problem = text === undefined ? undefined : jsonPathProblem(text);
    if (problem !== undefined)
      yield error(member(path, name), "json-path", `expected a JSONPath of a rule. ${problem}`);
  }
}

/** Lists the ids that a Determining Property names, each with its path. */
function* determiningIds(
  template: StatementTemplate,
  path: string,
): Generator<{ id: string; at: string; type: string }> {
  for (const [property, type] of DETERMINING) {
    const value = template[property];
    if (typeof value === "string") yield { id: value, at: member(path, property), type };
    else for (const [index, id] of (value ?? []).entries()) yield { id, at: item(member(path, property), index), type };
  }
}

/** Judges what the Determining Properties of a template name, when a profile defines it: a concept of the right type. */
function* determiningIssues(
  template: StatementTemplate,
  path: string,
  references: ProfileReferences,
): Generator<Issue> {
  for (const { id, at, type } of determiningIds(template, path)) {
    const concept = findConcept(references, id);
    if (concept === undefined || concept.type === type) continue;
    yield error(
      at,
      "determining-property",
      `expected a concept of the type ${type}, found ${JSON.stringify(id)}, of the type ${concept.type}.`,
    );
  }
}

/** Judges the StatementRef templates of a template: templates of this profile. */
function* referenceIssues(template: StatementTemplate, path: string, references: ProfileReferences): Generator<Issue> {
  for (const property of ["objectStatementRefTemplate", "contextStatementRefTemplate"] as const) {
    for (const [index, id] of (template[property] ?? []).entries()) {
      if (references.templates.has(id)) continue;
      yield error(
        item(member(path, property), index),
        "statement-ref-template",
        `expected the id of a Statement Template of this profile, found ${JSON.stringify(id)}.`,
      );
    }
  }
}

/** Judges one Statement Template. */
function* templateIssues(template: StatementTemplate, path: string, references: ProfileReferences): Generator<Issue> {
  if (template.objectActivityType !== undefined && template.objectStatementRefTemplate !== undefined) {
    yield error(
      path,
      "object-type-and-reference",
      "expected at most one of objectActivityType and objectStatementRefTemplate.",
    );
  }
  yield* determiningIssues(template, path, references);
  yield* referenceIssues(template, path, references);
  for (const [index, rule] of (template.rules ?? []).entries()) {
    yield* ruleIssues(rule, item(member(path, "rules"), index));
  }
}

/** Judges the Statement Templates of a profile. */
export function* templatesIssues(
  templates: readonly StatementTemplate[],
  references: ProfileReferences,
): Generator<Issue> {
  for (const [index, template] of templates.entries())
    yield* templateIssues(template, item("templates", index), references);
}
