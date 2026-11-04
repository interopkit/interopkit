import type { LanguageMap } from "../model/index.js";

/** The types of the concepts that relate to others of their type: broader, narrower, related and matching ones. */
export const VOCABULARY_CONCEPT_TYPES = ["Verb", "ActivityType", "AttachmentUsageType"] as const;

/** The type of a {@link VocabularyConcept}. */
export type VocabularyConceptType = (typeof VOCABULARY_CONCEPT_TYPES)[number];

/** The types of the extensions, each for one place of a Statement: the context, the result, an Activity Definition. */
export const EXTENSION_CONCEPT_TYPES = ["ContextExtension", "ResultExtension", "ActivityExtension"] as const;

/** The type of an {@link ExtensionConcept}. */
export type ExtensionConceptType = (typeof EXTENSION_CONCEPT_TYPES)[number];

/** The types of the document resources, each for one document resource of an LRS. */
export const DOCUMENT_RESOURCE_TYPES = ["StateResource", "AgentProfileResource", "ActivityProfileResource"] as const;

/** The type of a {@link DocumentResourceConcept}. */
export type DocumentResourceType = (typeof DOCUMENT_RESOURCE_TYPES)[number];

/** The properties that every concept has. */
interface ConceptBase {
  /** The IRI of the concept. */
  readonly id: string;
  /** The IRI of the version of the profile that describes the concept. */
  readonly inScheme: string;
  /** Whether the concept is deprecated. */
  readonly deprecated?: boolean;
}

/**
 * A Verb, an Activity Type or an Attachment Usage Type: a term that a Statement uses, with how it relates to others of its type.
 *
 * @remarks
 * `broader`, `narrower` and `related` name concepts of the same type in the same version of the profile, `related` only on a
 * deprecated concept; the `*Match` properties name concepts of other profiles or versions.
 */
export interface VocabularyConcept extends ConceptBase {
  /** `Verb`, `ActivityType` or `AttachmentUsageType`. */
  readonly type: VocabularyConceptType;
  /** The preferred names, by language. */
  readonly prefLabel: LanguageMap;
  /** What the term means and how a Statement uses it, by language. */
  readonly definition: LanguageMap;
  /** Concepts of this version with a broader meaning. */
  readonly broader?: readonly string[];
  /** Concepts of other profiles with a broader meaning. */
  readonly broadMatch?: readonly string[];
  /** Concepts of this version with a narrower meaning. */
  readonly narrower?: readonly string[];
  /** Concepts of other profiles with a narrower meaning. */
  readonly narrowMatch?: readonly string[];
  /** Concepts of this version that may replace a deprecated one. */
  readonly related?: readonly string[];
  /** Concepts of other profiles or versions with a related meaning. */
  readonly relatedMatch?: readonly string[];
  /** Concepts of other profiles or versions with the same meaning. */
  readonly exactMatch?: readonly string[];
}

/** The properties of a concept that names the form of a value: an extension or a document resource. */
interface ShapedConcept extends ConceptBase {
  /** A descriptive name, by language. */
  readonly prefLabel: LanguageMap;
  /** The purpose and the use, by language. */
  readonly definition: LanguageMap;
  /** The IRI of a JSON-LD context for the value. */
  readonly context?: string;
  /** The IRI of a JSON Schema for the value. */
  readonly schema?: string;
  /** A JSON Schema for the value, as the text of its JSON; a concept has this or `schema`, never both. */
  readonly inlineSchema?: string;
}

/** An extension: the IRI that a Statement uses as the key of an extension, with the form of its value. */
export interface ExtensionConcept extends ShapedConcept {
  /** `ContextExtension`, `ResultExtension` or `ActivityExtension`: where in a Statement the extension goes. */
  readonly type: ExtensionConceptType;
  /** The activity types that an `ActivityExtension` is meant for, and those narrower than them. */
  readonly recommendedActivityTypes?: readonly string[];
  /** The verbs that a `ContextExtension` or a `ResultExtension` is meant for, and those narrower than them. */
  readonly recommendedVerbs?: readonly string[];
}

/** A document resource: the id of a document of an LRS, with its media type and the form of its content. */
export interface DocumentResourceConcept extends ShapedConcept {
  /** `StateResource`, `AgentProfileResource` or `ActivityProfileResource`: the resource that holds the document. */
  readonly type: DocumentResourceType;
  /** The media type of the document, with any parameters, as `Content-Type` carries it. */
  readonly contentType: string;
}

/** The Activity Definition of an Activity concept: one of xAPI with the JSON-LD context of its extensions. */
export interface ProfileActivityDefinition {
  /** The JSON-LD context: `https://w3id.org/xapi/profiles/activity-context`, or a list that holds it. */
  readonly "@context": string | readonly string[];
  /** The names of the Activity, by language. */
  readonly name?: LanguageMap;
  /** The description of the Activity, by language. */
  readonly description?: LanguageMap;
  /** The activity type. */
  readonly type?: string;
  /** An IRL with more about the Activity. */
  readonly moreInfo?: string;
  /** The interaction type of an assessment item. */
  readonly interactionType?: string;
  /** The patterns of the correct responses. */
  readonly correctResponsesPattern?: readonly string[];
  /** The choices of a `choice` or `sequencing` interaction. */
  readonly choices?: readonly ProfileInteractionComponent[];
  /** The scale of a `likert` interaction. */
  readonly scale?: readonly ProfileInteractionComponent[];
  /** The sources of a `matching` interaction. */
  readonly source?: readonly ProfileInteractionComponent[];
  /** The targets of a `matching` interaction. */
  readonly target?: readonly ProfileInteractionComponent[];
  /** The steps of a `performance` interaction. */
  readonly steps?: readonly ProfileInteractionComponent[];
  /** The extensions of the Activity, each object of which carries its own `@context`. */
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/** A component of an interaction of an Activity concept. */
export interface ProfileInteractionComponent {
  /** The id of the component in the interaction. */
  readonly id: string;
  /** The description of the component, by language. */
  readonly description?: LanguageMap;
}

/** An Activity that the profile provides for Statements to use: its canonical definition. */
export interface ActivityConcept extends ConceptBase {
  /** `Activity`. */
  readonly type: "Activity";
  /** The definition that a Statement gives the Activity, or leaves out. */
  readonly activityDefinition: ProfileActivityDefinition;
}

/** A concept of a profile: a building block that Statements and other profiles use. */
export type Concept = VocabularyConcept | ExtensionConcept | DocumentResourceConcept | ActivityConcept;
