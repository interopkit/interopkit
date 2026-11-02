/**
 * cmi5 course launch: the vocabularies of the specification, and the course structure with its reader, validator and writer.
 *
 * @module @interopkit/course-launch
 */

export {
  type AssignableUnit,
  type Block,
  CMI5_ACTIVITY_TYPES,
  CMI5_CATEGORIES,
  CMI5_EXTENSIONS,
  CMI5_VERBS,
  type Cmi5Verb,
  COURSE_STRUCTURE_NAMESPACE,
  type Course,
  type CourseIssue,
  type CourseStructure,
  type ExtensionElement,
  LAUNCH_DATA_STATE_ID,
  LAUNCH_METHODS,
  LAUNCH_MODES,
  type LangString,
  type LaunchMethod,
  type LaunchMode,
  LEARNER_PREFERENCES_PROFILE_ID,
  MOVE_ON_VALUES,
  type MoveOn,
  type Objective,
} from "./model/index.js";
export {
  type CourseReadOptions,
  readCourseStructure,
  validateCourseStructure,
  writeCourseStructure,
} from "./structure/index.js";
