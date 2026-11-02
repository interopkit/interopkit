import type { JsonValue } from "@interopkit/core/checks";
import type { SubmissionReview } from "../claims/index.js";

/**
 * How far a user is in an activity, as a score says it (AGS 3.4.6).
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/services/assignments_grades/assignment-grade-services-spec#activityprogress | LTI AGS 2.0, activityProgress}
 */
export const ACTIVITY_PROGRESS = ["Initialized", "Started", "InProgress", "Submitted", "Completed"] as const;

/** How far a user is in an activity, as a score says it. */
export type ActivityProgress = (typeof ACTIVITY_PROGRESS)[number];

/**
 * How far grading is, as a score says it (AGS 3.4.7).
 *
 * @see {@link https://standards.1edtech.org/lti/specifications/services/assignments_grades/assignment-grade-services-spec#gradingprogress | LTI AGS 2.0, gradingProgress}
 */
export const GRADING_PROGRESS = ["FullyGraded", "Pending", "PendingManual", "Failed", "NotReady"] as const;

/** How far grading is, as a score says it. */
export type GradingProgress = (typeof GRADING_PROGRESS)[number];

/** What a tool gives to create or replace a line item (AGS 3.2). */
export interface LineItemInput {
  /** The most a user can score, above 0. */
  readonly scoreMaximum: number;
  /** A short human-readable name, not blank. */
  readonly label: string;
  /** The tool's identifier of the resource the line item is for. */
  readonly resourceId?: string;
  /** The resource link the line item is bound to. */
  readonly resourceLinkId?: string;
  /** A tag that tells the line items of one resource apart, such as `originality`. */
  readonly tag?: string;
  /** When the line item starts to receive submissions, with a time zone designator. */
  readonly startDateTime?: string;
  /** When the line item stops receiving submissions, with a time zone designator. */
  readonly endDateTime?: string;
  /** The activity of the platform that the line item is attached to. */
  readonly activityId?: string;
  /** Whether the tool wants the grades released to learners. */
  readonly gradesReleased?: boolean;
  /** The launch back to the work behind a result; absent when the tool offers none. */
  readonly submissionReview?: SubmissionReview;
  /** Properties that a vendor added, by the URL that names each (AGS 3.1). */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** A line item as a platform holds it: a column of the gradebook of a context. */
export interface LineItem extends LineItemInput {
  /** The address of the line item, which is also the base of its results and scores. */
  readonly id: string;
}

/** The score of one user for one line item (AGS 3.4). */
export interface Score {
  /** The user the score is for. */
  readonly userId: string;
  /** The user who gave the score, such as an instructor. */
  readonly scoringUserId?: string;
  /** The score, from 0; absent when the platform shall clear the score it holds. */
  readonly scoreGiven?: number;
  /** The denominator of `scoreGiven`, above 0; present when `scoreGiven` is. */
  readonly scoreMaximum?: number;
  /** A comment in plain text for the learner and the instructors. */
  readonly comment?: string;
  /** When the score was changed, with a time zone designator; strictly increasing for a user and a line item. */
  readonly timestamp: string;
  /** How far the user is in the activity. */
  readonly activityProgress: ActivityProgress;
  /** How far grading is. */
  readonly gradingProgress: GradingProgress;
  /** When the user began and finished the work. */
  readonly submission?: {
    /** When the user began. */
    readonly startedAt?: string;
    /** When the user finished, not before `startedAt`. */
    readonly submittedAt?: string;
  };
  /** Properties that a vendor added, by the URL that names each. */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** The current result of one user for a line item (AGS 3.3). */
export interface Result {
  /** The address of the result. */
  readonly id: string;
  /** The address of the line item it belongs to. */
  readonly scoreOf: string;
  /** The user the result is for. */
  readonly userId: string;
  /** The current score; absent when there is none. */
  readonly resultScore?: number;
  /** The denominator of `resultScore`, above 0; a platform that sends none means 1. */
  readonly resultMaximum?: number;
  /** The user who gave the score. */
  readonly scoringUserId?: string;
  /** The current comment. */
  readonly comment?: string;
  /** Properties that a vendor added, by the URL that names each. */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
}

/** The filters of a request for the line items of a context (AGS 3.2.5). */
export interface LineItemQuery {
  /** Only the line items of the tool's resource with this identifier. */
  readonly resourceId?: string;
  /** Only the line items bound to this resource link. */
  readonly resourceLinkId?: string;
  /** Only the line items with this tag. */
  readonly tag?: string;
  /** Only the line items attached to this activity of the platform. A platform that does not support it ignores it. */
  readonly activityId?: string;
  /** The most line items to return; the platform may return fewer or more. */
  readonly limit?: number;
}

/** The filters of a request for the results of a line item (AGS 3.3.8). */
export interface ResultQuery {
  /** Only the result of this user, at most one. */
  readonly userId?: string;
  /** The most results to return; the platform may return fewer or more. */
  readonly limit?: number;
}
