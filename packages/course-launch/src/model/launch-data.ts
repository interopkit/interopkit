import type { Agent, Context } from "@interopkit/learning-records";
import type { LaunchMode, MoveOn } from "./vocabularies.js";

/**
 * The values of the audio preference of a learner.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#audio_preference | cmi5, 11.2 audioPreference}
 */
export const AUDIO_PREFERENCES = ["on", "off"] as const;

/** Whether a learner wants audio. */
export type AudioPreference = (typeof AUDIO_PREFERENCES)[number];

/**
 * What the LMS gives an assignable unit in the State document `LMS.LaunchData` before it launches it.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#xapi_state | cmi5, 10.0 xAPI State Data Model}
 */
export interface LaunchData {
  /** The context that every statement of the session holds, the session id and the publisher id among it. */
  readonly contextTemplate: Context;
  /** The mode of the launch. */
  readonly launchMode: LaunchMode;
  /** What satisfies the assignable unit. */
  readonly moveOn: MoveOn;
  /**
   * The static parameters of the launch.
   *
   * @defaultValue none
   */
  readonly launchParameters?: string;
  /**
   * The scaled score at which the learner passes.
   *
   * @defaultValue none
   */
  readonly masteryScore?: number;
  /**
   * Where the assignable unit sends the learner when it terminates, `returnURL` in the document.
   *
   * @defaultValue none
   */
  readonly returnUrl?: string;
  /**
   * What the assignable unit reads to decide whether the LMS may use it.
   *
   * @defaultValue none
   */
  readonly entitlementKey?: {
    /** The `entitlementKey` of the course structure. */
    readonly courseStructure: string;
    /**
     * A value from another source, as the LMS and the assignable unit agree.
     *
     * @defaultValue none
     */
    readonly alternate?: string;
  };
}

/**
 * The preferences of a learner, the Agent Profile document `cmi5LearnerPreferences`.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#xapi_agent_profile | cmi5, 11.0 xAPI Agent Profile Data Model}
 */
export interface LearnerPreferences {
  /**
   * The languages of the learner as RFC 5646 tags, the preferred first.
   *
   * @defaultValue none
   */
  readonly languagePreference?: readonly string[];
  /**
   * Whether audio is on or off at the start.
   *
   * @defaultValue none: the assignable unit chooses
   */
  readonly audioPreference?: AudioPreference;
}

/**
 * The parameters of a launch URL, which an assignable unit reads in any order.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#launch_method | cmi5, 8.1 Launch Method}
 */
export interface LaunchParameters {
  /** The base endpoint of xAPI of the LMS, https. */
  readonly endpoint: string;
  /** The URL that the assignable unit posts to once for its authorization token, https. */
  readonly fetch: string;
  /** The learner, an Agent with an account. */
  readonly actor: Agent;
  /** The registration, a UUID. */
  readonly registration: string;
  /** The id of the activity of the assignable unit, which the LMS made, an IRI. */
  readonly activityId: string;
}
