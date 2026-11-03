/**
 * The runtime of a cmi5 assignable unit: the launch URL, the fetch of the token, the launch data and the preferences, and the
 * statements of a session, judged by the rules of cmi5 before they are sent. It has no DOM, so content in a browser and in any
 * other runtime uses it alike.
 *
 * @module @interopkit/course-launch/au
 */
export type {
  AllowedStatementInput,
  AuSession,
  OutcomeOptions,
  PriorOutcome,
  Recorded,
} from "./au-session.js";
export type { AuOptions, AuResume, AuVerb } from "./options.js";
export { type AuRefusal, startAuSession } from "./start-au-session.js";
