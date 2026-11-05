/**
 * cmi5 course launch: the vocabularies of the specification, the course structure with its reader, validator and writer, and
 * the rules of the statements of a session with the readers of the launch URL, the launch data and the learner preferences.
 *
 * It also exports the types of `@interopkit/core` and `@interopkit/learning-records` that its declarations name, which a
 * program that installs this package imports from here.
 *
 * @module @interopkit/course-launch
 */

export type { CallOptions, Clock, Fetch } from "@interopkit/core";
export type { Issue, JsonObject } from "@interopkit/core/checks";
export type { HttpRequest, HttpResponse } from "@interopkit/core/http";
export type {
  Actor,
  Agent,
  Attachment,
  Context,
  LrsDocument,
  LrsDocumentInput,
  Result,
  Score,
  Statement,
  StatementObject,
  Verb,
} from "@interopkit/learning-records";
export type { LrsClient, WriteOutcome } from "@interopkit/learning-records/client";
export type { LrsOptions } from "@interopkit/learning-records/store";
export {
  type AssignableUnit,
  AU_VERBS,
  AUDIO_PREFERENCES,
  type AudioPreference,
  type AuVerb,
  type Block,
  CMI5_ACTIVITY_TYPES,
  CMI5_CATEGORIES,
  CMI5_EXTENSIONS,
  CMI5_VERBS,
  type Cmi5Verb,
  COURSE_STRUCTURE_NAMESPACE,
  type Course,
  type CourseStructure,
  type ExtensionElement,
  LAUNCH_DATA_STATE_ID,
  LAUNCH_METHODS,
  LAUNCH_MODES,
  type LangString,
  type LaunchData,
  type LaunchMethod,
  type LaunchMode,
  type LaunchParameters,
  LEARNER_PREFERENCES_PROFILE_ID,
  type LearnerPreferences,
  MOVE_ON_VALUES,
  type MoveOn,
  type Objective,
} from "./model/index.js";
export {
  classifyStatement,
  readLaunchData,
  readLaunchUrl,
  readLearnerPreferences,
  type SessionFacts,
  validateSessionStatements,
  writeLearnerPreferences,
} from "./rules/index.js";
export {
  type CourseReadOptions,
  type CourseWriteOptions,
  readCourseStructure,
  validateCourseStructure,
  writeCourseStructure,
} from "./structure/index.js";
