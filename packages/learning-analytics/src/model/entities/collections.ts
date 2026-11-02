import type { AggregateMeasure } from "./assessment.js";
import type { Entity, Ref } from "./entity.js";
import type { CaliperEntity } from "./entity-map.js";
import type { QuestionnaireItem } from "./questionnaire.js";
import type { AnyDigitalResource } from "./ranges.js";
import type { DigitalResource, Message } from "./resources.js";

/**
 * An unordered collection of entities (Caliper 1.2 B.12). A sender uses the generic type only when no subtype fits.
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface Collection<TType extends string = "Collection"> extends Entity<TType> {
  /** The entities of the collection. */
  readonly items?: readonly Ref<CaliperEntity>[];
}

/** A collection of aggregate measures (Caliper 1.2 B.3). */
export interface AggregateMeasureCollection extends Collection<"AggregateMeasureCollection"> {
  /** The aggregate measures of the collection. */
  readonly items?: readonly Ref<AggregateMeasure>[];
}

/**
 * An ordered collection of digital resources (Caliper 1.2 B.19).
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface DigitalResourceCollection<TType extends string = "DigitalResourceCollection">
  extends Collection<TType>,
    DigitalResource<TType> {
  /** The digital resources of the collection. */
  readonly items?: readonly Ref<AnyDigitalResource>[];
}

/** A channel or virtual space for group discussion (Caliper 1.2 B.22). */
export interface Forum extends DigitalResourceCollection<"Forum"> {
  /** The threads of the forum. */
  readonly items?: readonly Ref<Thread>[];
}

/** A series of messages that share a subject and answer one another (Caliper 1.2 B.66). */
export interface Thread extends DigitalResourceCollection<"Thread"> {
  /** The messages of the thread. */
  readonly items?: readonly Ref<Message>[];
}

/** A set of questionnaire items that elicits information from respondents (Caliper 1.2 B.49). */
export interface Questionnaire extends DigitalResourceCollection<"Questionnaire"> {
  /** The questionnaire items that make up the questionnaire. */
  readonly items: readonly Ref<QuestionnaireItem>[];
}

/** A method of collecting data from a targeted group of respondents with questionnaires (Caliper 1.2 B.63). */
export interface Survey extends Collection<"Survey"> {
  /** The questionnaires of the survey. */
  readonly items?: readonly Ref<Questionnaire>[];
}
