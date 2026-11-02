/**
 * The namespace of the course structure of cmi5, which `CourseStructure.xsd` targets.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#course_package | cmi5, 14.0 Course Package}
 */
export const COURSE_STRUCTURE_NAMESPACE = "https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd";

/**
 * The criteria by which an LMS judges an assignable unit satisfied, in the order of the specification.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#au_meta_data | cmi5, 13.1.4 AU Metadata}
 */
export const MOVE_ON_VALUES = [
  "Passed",
  "Completed",
  "CompletedAndPassed",
  "CompletedOrPassed",
  "NotApplicable",
] as const;

/** The criterion by which an LMS judges an assignable unit satisfied. */
export type MoveOn = (typeof MOVE_ON_VALUES)[number];

/**
 * The windows an assignable unit may run in: one of its own, or any that the LMS chooses.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#au_meta_data | cmi5, 13.1.4 AU Metadata}
 */
export const LAUNCH_METHODS = ["AnyWindow", "OwnWindow"] as const;

/** The window an assignable unit runs in. */
export type LaunchMethod = (typeof LAUNCH_METHODS)[number];

/**
 * The modes an LMS launches an assignable unit in: `Normal` records, `Browse` and `Review` record no completion or score.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#xapi_state_properties_launchMode | cmi5, 10.2.2 launchMode}
 */
export const LAUNCH_MODES = ["Normal", "Browse", "Review"] as const;

/** The mode an LMS launches an assignable unit in. */
export type LaunchMode = (typeof LAUNCH_MODES)[number];

/**
 * The verbs of the statements that cmi5 defines, by name.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#verbs | cmi5, 9.3 Verbs}
 */
export const CMI5_VERBS = {
  /** The LMS launched the assignable unit. */
  launched: "http://adlnet.gov/expapi/verbs/launched",
  /** The assignable unit started its session. */
  initialized: "http://adlnet.gov/expapi/verbs/initialized",
  /** The learner completed the content. */
  completed: "http://adlnet.gov/expapi/verbs/completed",
  /** The learner passed. */
  passed: "http://adlnet.gov/expapi/verbs/passed",
  /** The learner failed. */
  failed: "http://adlnet.gov/expapi/verbs/failed",
  /** The LMS ended a session that the assignable unit did not terminate. */
  abandoned: "https://w3id.org/xapi/adl/verbs/abandoned",
  /** The LMS waived the assignable unit for a learner. */
  waived: "https://w3id.org/xapi/adl/verbs/waived",
  /** The assignable unit ended its session. */
  terminated: "http://adlnet.gov/expapi/verbs/terminated",
  /** The LMS judged a block or the course satisfied. */
  satisfied: "https://w3id.org/xapi/adl/verbs/satisfied",
} as const;

/** The name of a verb that cmi5 defines. */
export type Cmi5Verb = keyof typeof CMI5_VERBS;

/**
 * The activities of the `category` of a context: every statement that cmi5 defines carries the first, and every statement
 * that carries `success` or `completion` the second.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#context_activities | cmi5, 9.6.2 contextActivities}
 */
export const CMI5_CATEGORIES = {
  /** Every statement that cmi5 defines. */
  cmi5: "https://w3id.org/xapi/cmi5/context/categories/cmi5",
  /** A statement that carries success or completion. */
  moveOn: "https://w3id.org/xapi/cmi5/context/categories/moveon",
} as const;

/**
 * The extensions of a context and of a result that cmi5 defines, by name.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#extensions | cmi5, 9.6.3 Extensions}
 */
export const CMI5_EXTENSIONS = {
  /** The id of the session of a statement. */
  sessionId: "https://w3id.org/xapi/cmi5/context/extensions/sessionid",
  /** The mastery score of the launch. */
  masteryScore: "https://w3id.org/xapi/cmi5/context/extensions/masteryscore",
  /** The mode of the launch. */
  launchMode: "https://w3id.org/xapi/cmi5/context/extensions/launchmode",
  /** The URL of the launch. */
  launchUrl: "https://w3id.org/xapi/cmi5/context/extensions/launchurl",
  /** The static parameters of the launch. */
  launchParameters: "https://w3id.org/xapi/cmi5/context/extensions/launchparameters",
  /** What satisfies the assignable unit. */
  moveOn: "https://w3id.org/xapi/cmi5/context/extensions/moveon",
  /** Why the LMS waived the assignable unit. */
  reason: "https://w3id.org/xapi/cmi5/result/extensions/reason",
  /** How far the learner is, from 0 to 100. */
  progress: "https://w3id.org/xapi/cmi5/result/extensions/progress",
} as const;

/**
 * The types of the activities that stand for a block and for the course in the statements of an LMS.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#object | cmi5, 9.4 Object}
 */
export const CMI5_ACTIVITY_TYPES = {
  /** A block of the course structure. */
  block: "https://w3id.org/xapi/cmi5/activitytype/block",
  /** The course. */
  course: "https://w3id.org/xapi/cmi5/activitytype/course",
} as const;

/**
 * The id of the State document that an LMS writes before a launch.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#xapi_state | cmi5, 10.0 xAPI State Data Model}
 */
export const LAUNCH_DATA_STATE_ID = "LMS.LaunchData";

/**
 * The id of the Agent Profile document that holds the preferences of a learner.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#xapi_agent_profile | cmi5, 11.0 xAPI Agent Profile Data Model}
 */
export const LEARNER_PREFERENCES_PROFILE_ID = "cmi5LearnerPreferences";
