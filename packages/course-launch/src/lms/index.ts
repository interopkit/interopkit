/**
 * The LMS role of cmi5: the import of a course, registrations, launches, the fetch URL, the rules of cmi5 on the host's LRS,
 * satisfaction, abandoned sessions and waivers.
 *
 * @module @interopkit/course-launch/lms
 */
export { abandonSession } from "./abandon-session.js";
export { createRegistration, type RegistrationInput } from "./create-registration.js";
export { extendLrsOptions } from "./extend-lrs-options.js";
export { handleFetchRequest } from "./handle-fetch-request.js";
export { type ImportInput, importCourse } from "./import-course.js";
export type { LmsOptions } from "./options.js";
export { type Launch, type LaunchInput, prepareLaunch } from "./prepare-launch.js";
export { type CourseProgress, progressOf } from "./progress.js";
export {
  type AuOutcome,
  type Cmi5Store,
  type ImportedAu,
  type ImportedBlock,
  type ImportedCourse,
  type PutOutcome,
  type Registration,
  type RegistrationAu,
  type Reservation,
  SESSION_STATES,
  type Session,
  type SessionState,
} from "./records.js";
export { type WaiverInput, waiveAu } from "./waive-au.js";
