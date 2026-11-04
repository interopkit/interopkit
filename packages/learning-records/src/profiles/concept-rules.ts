import {
  createIssueSink,
  DEFAULT_MAX_FINDINGS,
  describe,
  type Issue,
  isRecord,
  MAX_JSON_DEPTH,
  MAX_JSON_TOKENS,
  parseJsonText,
} from "@interopkit/core/checks";
import { error, inspectStatement, item, member, warning } from "../read/internal.js";
import type {
  ActivityConcept,
  Concept,
  DocumentResourceConcept,
  ExtensionConcept,
  VocabularyConcept,
} from "./concepts.js";
import { ACTIVITY_CONTEXT } from "./profile.js";
import { contextIssues } from "./profile-rules.js";
import { findConcept, type ProfileReferences } from "./references.js";

/** What a relation of a vocabulary concept names: concepts of the same version, of other profiles, or of either. */
type RelationScope = "version" | "profiles" | "versions";

/** The relations of a vocabulary concept, each with what it names. */
const RELATIONS = [
  ["broader", "version"],
  ["narrower", "version"],
  ["related", "version"],
  ["broadMatch", "profiles"],
  ["narrowMatch", "profiles"],
  ["relatedMatch", "versions"],
  ["exactMatch", "versions"],
] as const;

/** The drafts of JSON Schema that an inline schema should follow, as its `$schema` names them. */
const DRAFT_07 = new Set(["http://json-schema.org/draft-07/schema", "http://json-schema.org/draft-07/schema#"]);

/** The Agent and the verb of the Statement in which the Activity Definition of a concept is read as xAPI reads one. */
const HOLDER = { actor: { mbox: "mailto:profile@example.org" }, verb: { id: "https://example.org/verbs/defines" } };

/** Says what is wrong with the concept that a relation of a vocabulary concept names, or returns `undefined`. */
function relationProblem(
  concept: VocabularyConcept,
  scope: RelationScope,
  id: string,
  references: ProfileReferences,
): string | undefined {
  if (id === concept.id) return "the concept itself";
  const target = findConcept(references, id);
  if (target !== undefined && target.type !== concept.type) return `a concept of the type ${target.type}`;
  const own = references.concepts.get(id);
  switch (scope) {
    case "version":
      if (own === undefined) return "which this profile does not define";
      return own.inScheme === concept.inScheme ? undefined : `a concept of the version ${JSON.stringify(own.inScheme)}`;
    case "profiles":
      return own === undefined ? undefined : "a concept of this profile";
    default:
      return own?.inScheme === concept.inScheme ? "a concept of the same version of this profile" : undefined;
  }
}

/** Judges where the relations of a Verb, an Activity Type or an Attachment Usage Type lead. */
function* vocabularyIssues(concept: VocabularyConcept, path: string, references: ProfileReferences): Generator<Issue> {
  for (const [relation, scope] of RELATIONS) {
    for (const [index, id] of (concept[relation] ?? []).entries()) {
      const problem = relationProblem(concept, scope, id, references);
      if (problem === undefined) continue;
      yield error(
        item(member(path, relation), index),
        "relation-target",
        `expected a concept of the type ${concept.type} that ${relation} may name, found ${JSON.stringify(id)}, ${problem}.`,
      );
    }
  }
  if (concept.related !== undefined && concept.deprecated !== true) {
    yield error(
      member(path, "related"),
      "related-deprecated",
      "expected related only on a deprecated concept, to name what replaces it.",
    );
  }
}

/** Judges the JSON Schema of a concept: one of `schema` and `inlineSchema`, and an inline schema that is a schema. */
function* schemaIssues(concept: ExtensionConcept | DocumentResourceConcept, path: string): Generator<Issue> {
  if (concept.schema !== undefined && concept.inlineSchema !== undefined) {
    yield error(path, "schema-and-inline-schema", "expected at most one of schema and inlineSchema.");
  }
  if (concept.inlineSchema === undefined) return;
  const at = member(path, "inlineSchema");
  let schema: unknown;
  try {
    schema = parseJsonText(
      concept.inlineSchema,
      { maxDepth: MAX_JSON_DEPTH, maxTokens: MAX_JSON_TOKENS },
      {
        depth: `nests deeper than ${MAX_JSON_DEPTH} levels`,
        tokens: `has more than ${MAX_JSON_TOKENS} tokens`,
        syntax: () => "is not JSON",
      },
    );
  } catch (caught) {
    const problem = caught instanceof Error ? caught.message : String(caught);
    yield error(at, "inline-schema", `expected the text of a JSON Schema, found text that ${problem}.`);
    return;
  }
  if (typeof schema !== "boolean" && !isRecord(schema)) {
    yield error(
      at,
      "inline-schema",
      `expected the text of a JSON Schema, an object or a boolean, found ${describe(schema)}.`,
    );
  } else if (isRecord(schema) && typeof schema.$schema === "string" && !DRAFT_07.has(schema.$schema)) {
    yield warning(
      at,
      "inline-schema-draft",
      `expected a schema of JSON Schema draft-07, found ${JSON.stringify(schema.$schema)}.`,
    );
  }
}

/** Judges where the recommendations of an extension may be, and what they name. */
function* extensionIssues(concept: ExtensionConcept, path: string, references: ProfileReferences): Generator<Issue> {
  const activity = concept.type === "ActivityExtension";
  if (concept.recommendedActivityTypes !== undefined && !activity) {
    yield error(
      member(path, "recommendedActivityTypes"),
      "recommended-activity-types",
      "expected recommendedActivityTypes only on an ActivityExtension.",
    );
  }
  if (concept.recommendedVerbs !== undefined && activity) {
    yield error(
      member(path, "recommendedVerbs"),
      "recommended-verbs",
      "expected recommendedVerbs only on a ContextExtension or a ResultExtension.",
    );
  }
  for (const [relation, type] of [
    ["recommendedActivityTypes", "ActivityType"],
    ["recommendedVerbs", "Verb"],
  ] as const) {
    for (const [index, id] of (concept[relation] ?? []).entries()) {
      const target = findConcept(references, id);
      if (target !== undefined && target.type !== type) {
        yield error(
          item(member(path, relation), index),
          "relation-target",
          `expected a concept of the type ${type}, found ${JSON.stringify(id)}, of the type ${target.type}.`,
        );
      }
    }
  }
  yield* schemaIssues(concept, path);
}

/**
 * Judges the Activity Definition of an Activity concept: its context, the rules of xAPI for an Activity Definition, and the
 * JSON-LD context of each object of its extensions.
 */
function* activityIssues(concept: ActivityConcept, path: string): Generator<Issue> {
  const at = member(path, "activityDefinition");
  const definition = concept.activityDefinition;
  yield* contextIssues(definition["@context"], ACTIVITY_CONTEXT, member(at, "@context"));
  const xapi = Object.fromEntries(Object.entries(definition).filter(([name]) => !name.startsWith("@")));
  const sink = createIssueSink(DEFAULT_MAX_FINDINGS, false);
  inspectStatement(
    { ...HOLDER, object: { id: concept.id, definition: xapi } },
    { role: "lrs", version: "1.0.3" },
    sink,
  );
  for (const issue of sink.list()) {
    yield { ...issue, path: issue.path.replace(/^object\.definition/u, at) };
  }
  // The definition is carried as JSON and judged as xAPI above: extensions that are no object have their finding there.
  for (const [key, value] of Object.entries(isRecord(definition.extensions) ? definition.extensions : {})) {
    const values: readonly unknown[] = Array.isArray(value) ? value : [value];
    if (values.some((entry) => isRecord(entry) && entry["@context"] === undefined)) {
      yield error(
        member(member(at, "extensions"), key),
        "extension-context",
        "expected a JSON-LD @context in every object of the extension.",
      );
    }
  }
}

/** Judges one concept by the rules of its type. */
function conceptIssues(concept: Concept, path: string, references: ProfileReferences): Iterable<Issue> {
  switch (concept.type) {
    case "Verb":
    case "ActivityType":
    case "AttachmentUsageType":
      return vocabularyIssues(concept, path, references);
    case "ContextExtension":
    case "ResultExtension":
    case "ActivityExtension":
      return extensionIssues(concept, path, references);
    case "Activity":
      return activityIssues(concept, path);
    default:
      return schemaIssues(concept, path);
  }
}

/** Judges the concepts of a profile, each by the rules of its type. */
export function* conceptsIssues(concepts: readonly Concept[], references: ProfileReferences): Generator<Issue> {
  for (const [index, concept] of concepts.entries()) yield* conceptIssues(concept, item("concepts", index), references);
}
