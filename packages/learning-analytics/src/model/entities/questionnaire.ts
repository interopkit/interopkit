import type { Survey } from "./collections.js";
import type { Entity, Ref } from "./entity.js";
import type { CaliperEntity } from "./entity-map.js";
import type { Person } from "./people.js";
import type { AnyQuestion, AnyScale } from "./ranges.js";
import type { DigitalResource } from "./resources.js";

/**
 * A question put to a respondent, closed with predefined answers or open-ended (Caliper 1.2 B.48). A sender uses the generic
 * type only when no subtype fits.
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface Question<TType extends string = "Question"> extends DigitalResource<TType> {
  /** The question that is posed. */
  readonly questionPosed?: string;
}

/** A closed question that is answered with a date and time (Caliper 1.2 B.16). */
export interface DateTimeQuestion extends Question<"DateTimeQuestion"> {
  /** The earliest date and time that is allowed. */
  readonly minDateTime?: string;
  /** The label of the earliest date and time. */
  readonly minLabel?: string;
  /** The latest date and time that is allowed. */
  readonly maxDateTime?: string;
  /** The label of the latest date and time. */
  readonly maxLabel?: string;
}

/** A closed question where the respondent chooses several of a set of options (Caliper 1.2 B.38). */
export interface MultiselectQuestion extends Question<"MultiselectQuestion"> {
  /** The number of points of the question. */
  readonly points?: number;
  /** The labels of the options. */
  readonly itemLabels?: readonly string[];
  /** The values of the options. */
  readonly itemValues?: readonly string[];
}

/** A question with no predefined answer (Caliper 1.2 B.42). */
export interface OpenEndedQuestion extends Question<"OpenEndedQuestion"> {}

/** A question that is answered on a scale (Caliper 1.2 B.52). */
export interface RatingScaleQuestion extends Question<"RatingScaleQuestion"> {
  /** The scale of the question. */
  readonly scale?: Ref<AnyScale>;
}

/** A question as a questionnaire poses it (Caliper 1.2 B.50). */
export interface QuestionnaireItem extends DigitalResource<"QuestionnaireItem"> {
  /** The question that the item poses. */
  readonly question?: Ref<AnyQuestion>;
  /** The categories that the item covers. */
  readonly categories?: readonly string[];
  /** The weight of the item. */
  readonly weight?: number;
}

/** An invitation to rate a survey, sent to a rater (Caliper 1.2 B.64). */
export interface SurveyInvitation extends DigitalResource<"SurveyInvitation"> {
  /** The person who is invited to rate. */
  readonly rater?: Ref<Person>;
  /** The survey that the invitation is for. */
  readonly survey?: Ref<Survey>;
  /** How many times the invitation was sent. */
  readonly sentCount?: number;
  /** When the invitation was sent, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly dateSent?: string;
}

/** A quantitative reaction to an entity (Caliper 1.2 B.51). */
export interface Rating extends Entity<"Rating"> {
  /** The person who gave the rating. */
  readonly rater?: Ref<Person>;
  /** The entity that was rated. */
  readonly rated?: Ref<CaliperEntity>;
  /** The question that the rating answers. */
  readonly question?: Ref<AnyQuestion>;
  /** The values that the rater selected. */
  readonly selections?: readonly string[];
  /** The comment that was left with the rating. */
  readonly ratingComment?: Ref<Comment>;
}

/** A person's qualitative reaction to an entity (Caliper 1.2 B.13). */
export interface Comment extends Entity<"Comment"> {
  /** The person who commented. */
  readonly commenter?: Ref<Person>;
  /** The entity that received the comment. */
  readonly commentedOn?: Ref<CaliperEntity>;
  /** The text of the comment. */
  readonly value?: string;
}

/**
 * A scale for capturing a rating (Caliper 1.2 B.56). A sender uses the generic type only when no subtype fits.
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface Scale<TType extends string = "Scale"> extends Entity<TType> {}

/** A Likert scale (Caliper 1.2 B.28). */
export interface LikertScale extends Scale<"LikertScale"> {
  /** The number of points on the scale. */
  readonly scalePoints?: number;
  /** The labels of the points, in order. */
  readonly itemLabels?: readonly string[];
  /** The values of the points, in order. */
  readonly itemValues?: readonly string[];
}

/** A scale for capturing one or more options (Caliper 1.2 B.40). */
export interface MultiselectScale extends Scale<"MultiselectScale"> {
  /** The number of points on the scale. */
  readonly scalePoints?: number;
  /** The labels of the points, in order. */
  readonly itemLabels?: readonly string[];
  /** The values of the points, in order. */
  readonly itemValues?: readonly string[];
  /** Whether the order of the selections matters. */
  readonly isOrderedSelection?: boolean;
  /** The fewest selections that may be chosen. */
  readonly minSelections?: number;
  /** The most selections that may be chosen. */
  readonly maxSelections?: number;
}

/** A numeric scale (Caliper 1.2 B.41). */
export interface NumericScale extends Scale<"NumericScale"> {
  /** The least value of the scale. */
  readonly minValue?: number;
  /** The label of the least value. */
  readonly minLabel?: string;
  /** The greatest value of the scale. */
  readonly maxValue?: number;
  /** The label of the greatest value. */
  readonly maxLabel?: string;
  /** The step between the options from the least to the greatest value. */
  readonly step?: number;
}
