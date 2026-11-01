import type { Extensions } from "./json.js";

/** The outcome of a graded Activity (4.2.2.4). */
export interface Score {
  /** The score as modified by scaling or normalization, a number from -1 to 1. */
  readonly scaled?: number;
  /** The score achieved, not modified by any scaling; from `min` to `max` when they are present. */
  readonly raw?: number;
  /** The lowest possible score; less than `max` when that is present. */
  readonly min?: number;
  /** The highest possible score; greater than `min` when that is present. */
  readonly max?: number;
}

/** A measured outcome of the experience that a Statement records (4.2.2.4). */
export interface Result {
  /** The score of the Actor. */
  readonly score?: Score;
  /** Whether the attempt on the Activity was successful. */
  readonly success?: boolean;
  /** Whether the Activity was completed. */
  readonly completion?: boolean;
  /** A response, formatted as the interaction of the Activity asks. */
  readonly response?: string;
  /** The time over which the Statement occurred, as an ISO 8601 duration such as `PT1H30M`. */
  readonly duration?: string;
  /** A map of other properties, whose keys are IRIs. */
  readonly extensions?: Extensions;
}
