import type { CaliperMetric } from "../internal.js";
import type { DigitalResourceCollection } from "./collections.js";
import type { Entity, Ref } from "./entity.js";
import type { Person } from "./people.js";
import type { AnyAgent, AnyDigitalResource } from "./ranges.js";
import type { AssignableDigitalResource } from "./resources.js";

/** An assessment instrument such as a test or a quiz (Caliper 1.2 B.5). */
export interface Assessment extends AssignableDigitalResource<"Assessment">, DigitalResourceCollection<"Assessment"> {
  /** The assessment items of the assessment. */
  readonly items?: readonly Ref<AssessmentItem>[];
}

/** A single question of a test (Caliper 1.2 B.6). */
export interface AssessmentItem extends AssignableDigitalResource<"AssessmentItem"> {
  /** Whether interacting with the item is time dependent. */
  readonly isTimeDependent?: boolean;
}

/** How many times an actor has interacted with a digital resource, with the times of the attempt (Caliper 1.2 B.8). */
export interface Attempt extends Entity<"Attempt"> {
  /** The attempt that this one belongs to, such as the attempt at a test that an attempt at one of its items is part of. */
  readonly isPartOf?: Ref<Attempt>;
  /** The person who made the attempt. */
  readonly assignee?: Ref<Person>;
  /** The digital resource that the attempt is of. */
  readonly assignable?: Ref<AnyDigitalResource>;
  /** The number of attempts against the resource, this one included. */
  readonly count?: number;
  /** When the attempt started, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly startedAtTime?: string;
  /** When the attempt ended, in the same form. */
  readonly endedAtTime?: string;
  /** How long the attempt took, as an ISO 8601 duration. */
  readonly duration?: string;
}

/**
 * The option that a person selected when interacting with a digital resource such as an assessment item (Caliper 1.2 B.54). A
 * sender uses the generic type only when no subtype fits.
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface Response<TType extends string = "Response"> extends Entity<TType> {
  /** The attempt that the response belongs to. */
  readonly attempt?: Ref<Attempt>;
  /** When the response started, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly startedAtTime?: string;
  /** When the response ended, in the same form. */
  readonly endedAtTime?: string;
  /** How long the response took, as an ISO 8601 duration. */
  readonly duration?: string;
}

/** A response to a date and time question (Caliper 1.2 B.17). */
export interface DateTimeResponse extends Response<"DateTimeResponse"> {
  /** The date and time that the respondent selected. */
  readonly dateTimeSelected?: string;
}

/** A response to an item that asks for words or short phrases that complete a statement (Caliper 1.2 B.21). */
export interface FillinBlankResponse extends Response<"FillinBlankResponse"> {
  /** The words, expressions or short phrases of the response. */
  readonly values?: readonly string[];
}

/** A response to an item that asks for the best answer from a list of choices (Caliper 1.2 B.36). */
export interface MultipleChoiceResponse extends Response<"MultipleChoiceResponse"> {
  /** The selected option. */
  readonly value?: string;
}

/** A response to an item that asks for every correct answer from a list of choices (Caliper 1.2 B.37). */
export interface MultipleResponseResponse extends Response<"MultipleResponseResponse"> {
  /** The selected options. */
  readonly values?: readonly string[];
}

/** A response to a multiselect question (Caliper 1.2 B.39). */
export interface MultiselectResponse extends Response<"MultiselectResponse"> {
  /** The values that the respondent selected. */
  readonly selections?: readonly string[];
}

/** A response to an open-ended question (Caliper 1.2 B.43). */
export interface OpenEndedResponse extends Response<"OpenEndedResponse"> {
  /** The text of the response. */
  readonly value?: string;
}

/** A response to a rating scale question (Caliper 1.2 B.53). */
export interface RatingScaleResponse extends Response<"RatingScaleResponse"> {
  /** The values that the respondent selected. */
  readonly selections?: readonly string[];
}

/** A response to an item that asks for text to be identified in a passage or list (Caliper 1.2 B.59). */
export interface SelectTextResponse extends Response<"SelectTextResponse"> {
  /** The selected options. */
  readonly values?: readonly string[];
}

/** A response to an item with two possible options, such as true and false (Caliper 1.2 B.67). */
export interface TrueFalseResponse extends Response<"TrueFalseResponse"> {
  /** The selected option. */
  readonly value?: string;
}

/** The current score or grade in a gradebook, which may be adjusted or scaled (Caliper 1.2 B.55). */
export interface Result extends Entity<"Result"> {
  /** The attempt that the result is for. */
  readonly attempt?: Ref<Attempt>;
  /** The greatest result score that is permitted. */
  readonly maxResultScore?: number;
  /** The result score that was awarded. */
  readonly resultScore?: number;
  /** The agent who scored the attempt. */
  readonly scoredBy?: Ref<AnyAgent>;
  /** Plain text feedback from the scorer. */
  readonly comment?: string;
}

/** The raw, unadjusted score awarded for a submission (Caliper 1.2 B.57). */
export interface Score extends Entity<"Score"> {
  /** The attempt that the score is for. */
  readonly attempt?: Ref<Attempt>;
  /** The greatest score that is permitted. */
  readonly maxScore?: number;
  /** The score that was awarded. */
  readonly scoreGiven?: number;
  /** The agent who scored the attempt. */
  readonly scoredBy?: Ref<AnyAgent>;
  /** Plain text feedback from the scorer. */
  readonly comment?: string;
}

/** A measure of a learner's use of a learning tool, summed over a period (Caliper 1.2 B.2). */
export interface AggregateMeasure extends Entity<"AggregateMeasure"> {
  /** The measure the actor reached. */
  readonly metricValue: number;
  /** The greatest measure the actor could reach. */
  readonly maxMetricValue?: number;
  /** What the measure counts. */
  readonly metric: CaliperMetric;
  /** When the aggregation began, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly startedAtTime?: string;
  /** When the aggregation ended, in the same form. */
  readonly endedAtTime?: string;
}
