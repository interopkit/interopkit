import { absoluteUriSchema, isRecord, opaqueJsonValueSchema, openRecord, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";
import { isIsoTimestamp } from "../model/internal.js";
import { languageMapSchema, mediaTypeSchema } from "../read/internal.js";
import {
  type ActivityConcept,
  type Concept,
  DOCUMENT_RESOURCE_TYPES,
  type DocumentResourceConcept,
  EXTENSION_CONCEPT_TYPES,
  type ExtensionConcept,
  type ProfileActivityDefinition,
  VOCABULARY_CONCEPT_TYPES,
  type VocabularyConcept,
} from "./concepts.js";
import type { Pattern } from "./patterns.js";
import type { Profile, ProfileAuthor, ProfileVersion } from "./profile.js";
import { RULE_PRESENCES, type StatementTemplate, type StatementTemplateRule } from "./templates.js";

const iri = absoluteUriSchema;
const iris = v.array(iri);
const text = v.string();
const flag = v.optional(v.boolean());

/** A JSON-LD `@context` of a profile: a URI, or a list of URIs. */
const contextSchema = v.union([iri, iris], (issue) => `expected a URI or a list of URIs, found ${issue.received}`);

/** A Timestamp, as xAPI writes one: ISO 8601 with a time zone. */
const timestampSchema = v.pipe(
  v.string(),
  v.check(
    isIsoTimestamp,
    (issue) =>
      `expected a date and time of ISO 8601 with a time zone, such as 2024-06-13T18:46:03Z, found ${issue.received}`,
  ),
);

const versionEntries = {
  id: iri,
  wasRevisionOf: v.optional(iris),
  generatedAtTime: timestampSchema,
};

const versionSchema: Schema<ProfileVersion> = openRecord(versionEntries);

const authorEntries = {
  type: v.picklist(["Organization", "Person"]),
  name: text,
  url: v.optional(iri),
};

const authorSchema: Schema<ProfileAuthor> = openRecord(authorEntries);

/** The properties of every concept. */
const conceptEntries = { id: iri, inScheme: iri, deprecated: flag };

/** The properties of a concept that names the form of a value. */
const shapedEntries = {
  ...conceptEntries,
  prefLabel: languageMapSchema,
  definition: languageMapSchema,
  context: v.optional(iri),
  schema: v.optional(iri),
  inlineSchema: v.optional(text),
};

const vocabularyEntries = {
  ...conceptEntries,
  type: v.picklist(VOCABULARY_CONCEPT_TYPES),
  prefLabel: languageMapSchema,
  definition: languageMapSchema,
  broader: v.optional(iris),
  broadMatch: v.optional(iris),
  narrower: v.optional(iris),
  narrowMatch: v.optional(iris),
  related: v.optional(iris),
  relatedMatch: v.optional(iris),
  exactMatch: v.optional(iris),
};

const vocabularyConceptSchema: Schema<VocabularyConcept> = openRecord(vocabularyEntries);

const extensionEntries = {
  ...shapedEntries,
  type: v.picklist(EXTENSION_CONCEPT_TYPES),
  recommendedActivityTypes: v.optional(iris),
  recommendedVerbs: v.optional(iris),
};

const extensionConceptSchema: Schema<ExtensionConcept> = openRecord(extensionEntries);

const documentEntries = {
  ...shapedEntries,
  type: v.picklist(DOCUMENT_RESOURCE_TYPES),
  contentType: mediaTypeSchema,
};

const documentResourceSchema: Schema<DocumentResourceConcept> = openRecord(documentEntries);

/**
 * The Activity Definition of an Activity concept: its `@context`, and the other properties carried as JSON, which the rules
 * of the profile judge as an xAPI Activity Definition.
 */
const activityDefinitionSchema: Schema<ProfileActivityDefinition> = openRecord({ "@context": contextSchema });

const activityEntries = {
  ...conceptEntries,
  type: v.literal("Activity"),
  activityDefinition: activityDefinitionSchema,
};

const activityConceptSchema: Schema<ActivityConcept> = openRecord(activityEntries);

/** The four kinds of concept: the table of properties that the specification lists for them, their types and their schema. */
const CONCEPT_KINDS = [
  ["vocabulary", VOCABULARY_CONCEPT_TYPES, vocabularyConceptSchema],
  ["extension", EXTENSION_CONCEPT_TYPES, extensionConceptSchema],
  ["document", DOCUMENT_RESOURCE_TYPES, documentResourceSchema],
  ["activity", ["Activity"], activityConceptSchema],
] as const;

/** The table of properties of each type of concept, by the type. */
export const CONCEPT_TABLES: ReadonlyMap<string, string> = new Map(
  CONCEPT_KINDS.flatMap(([table, types]) => types.map((type) => [type, table] as const)),
);

/** The schema of each type of concept. */
const CONCEPT_SCHEMAS: ReadonlyMap<string, Schema<Concept>> = new Map<string, Schema<Concept>>(
  CONCEPT_KINDS.flatMap(([, types, schema]) => types.map((type) => [type, schema] as const)),
);

/** Refuses a concept whose type is none of the specification's, by the type alone: what passes it is not reached. */
const unknownConceptSchema = v.pipe(openRecord({ type: v.picklist([...CONCEPT_SCHEMAS.keys()]) }), v.never());

/** A concept, read by the schema of its type. */
const conceptSchema: Schema<Concept> = v.lazy((input) => {
  const type = isRecord(input) && typeof input.type === "string" ? input.type : "";
  return CONCEPT_SCHEMAS.get(type) ?? unknownConceptSchema;
});

const ruleEntries = {
  location: text,
  selector: v.optional(text),
  presence: v.optional(v.picklist(RULE_PRESENCES)),
  any: v.optional(v.array(opaqueJsonValueSchema)),
  all: v.optional(v.array(opaqueJsonValueSchema)),
  none: v.optional(v.array(opaqueJsonValueSchema)),
  scopeNote: v.optional(languageMapSchema),
};

const ruleSchema: Schema<StatementTemplateRule> = openRecord(ruleEntries);

const templateEntries = {
  id: iri,
  type: v.literal("StatementTemplate"),
  inScheme: iri,
  prefLabel: languageMapSchema,
  definition: languageMapSchema,
  deprecated: flag,
  verb: v.optional(iri),
  objectActivityType: v.optional(iri),
  contextGroupingActivityType: v.optional(iris),
  contextParentActivityType: v.optional(iris),
  contextOtherActivityType: v.optional(iris),
  contextCategoryActivityType: v.optional(iris),
  attachmentUsageType: v.optional(iris),
  objectStatementRefTemplate: v.optional(iris),
  contextStatementRefTemplate: v.optional(iris),
  rules: v.optional(v.array(ruleSchema)),
};

const templateSchema: Schema<StatementTemplate> = openRecord(templateEntries);

const patternEntries = {
  id: iri,
  type: v.literal("Pattern"),
  primary: flag,
  inScheme: v.optional(iri),
  prefLabel: v.optional(languageMapSchema),
  definition: v.optional(languageMapSchema),
  deprecated: flag,
  alternates: v.optional(iris),
  optional: v.optional(iri),
  oneOrMore: v.optional(iri),
  sequence: v.optional(iris),
  zeroOrMore: v.optional(iri),
};

const patternSchema: Schema<Pattern> = openRecord(patternEntries);

const profileEntries = {
  "@context": contextSchema,
  id: iri,
  type: v.literal("Profile"),
  conformsTo: iri,
  prefLabel: languageMapSchema,
  definition: languageMapSchema,
  seeAlso: v.optional(iri),
  versions: v.array(versionSchema),
  author: authorSchema,
  concepts: v.optional(v.array(conceptSchema)),
  templates: v.optional(v.array(templateSchema)),
  patterns: v.optional(v.array(patternSchema)),
};

/**
 * Reads a profile into the model: every object, its properties, their types and their forms. The rules between objects and
 * properties are in the other files of the module.
 */
export const profileSchema: Schema<Profile> = openRecord(profileEntries);

/** The entries of the schema of each object of a profile, by table: their names are the properties that the specification lists. */
export const TABLE_ENTRIES = {
  profile: profileEntries,
  version: versionEntries,
  author: authorEntries,
  vocabulary: vocabularyEntries,
  extension: extensionEntries,
  document: documentEntries,
  activity: activityEntries,
  template: templateEntries,
  rule: ruleEntries,
  pattern: patternEntries,
} as const;
