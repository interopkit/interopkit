import type { Agent } from "@interopkit/learning-records";
import type { Cmi5Verb, LaunchData } from "../model/index.js";

/**
 * What the statements of one session are judged against: who and what the launch was for, its launch data, and what the
 * registration held before it.
 */
export interface SessionFacts {
  /** The learner, as the launch URL gave the actor. */
  readonly actor: Agent;
  /** The registration of the launch, a UUID. */
  readonly registration: string;
  /** The id of the activity of the assignable unit that the LMS made. */
  readonly activityId: string;
  /** The `LMS.LaunchData` of the session. */
  readonly launchData: LaunchData;
  /**
   * What the registration held for the assignable unit before the session: a completed and a passed statement.
   *
   * @defaultValue neither
   */
  readonly prior?: {
    /**
     * Whether it held a completed statement.
     *
     * @defaultValue false
     */
    readonly completed?: boolean;
    /**
     * Whether it held a passed statement.
     *
     * @defaultValue false
     */
    readonly passed?: boolean;
  };
  /**
   * Whether the assignable unit read the preferences of the learner before its initialized statement, which the LMS knows from
   * its requests; a session judged from its statements alone does not know it.
   *
   * @defaultValue not known, and not judged
   */
  readonly preferencesRead?: boolean;
}

/** What a session holds after the statements judged so far. */
export interface SessionProgress {
  /** The time of the initialized statement, in milliseconds, or `undefined` before it. */
  readonly initializedAt: number | undefined;
  /** Whether the terminated statement came. */
  readonly terminated: boolean;
  /** The verbs of the statements that cmi5 defines that the session used. */
  readonly verbs: readonly Cmi5Verb[];
  /** Whether the registration holds a completed statement. */
  readonly completed: boolean;
  /** Whether the registration holds a passed statement. */
  readonly passed: boolean;
}

/** What a session holds before its first statement: the registration as the facts give it. */
export function sessionStart(facts: SessionFacts): SessionProgress {
  return {
    initializedAt: undefined,
    terminated: false,
    verbs: [],
    completed: facts.prior?.completed === true,
    passed: facts.prior?.passed === true,
  };
}
