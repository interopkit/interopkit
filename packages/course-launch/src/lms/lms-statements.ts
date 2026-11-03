import {
  type Agent,
  buildStatement,
  deriveStatementId,
  formatDuration,
  formatTimestamp,
  type Statement,
} from "@interopkit/learning-records";
import { CMI5_ACTIVITY_TYPES, CMI5_CATEGORIES, CMI5_EXTENSIONS, CMI5_VERBS, type LaunchData } from "../model/index.js";
import type { ImportedAu, ImportedCourse, Session } from "./records.js";

/** The version of xAPI that cmi5 names, whose rules the statements of the LMS follow. */
const XAPI_VERSION = { version: "1.0.3" } as const;

/** Makes a UUID of version 5 under the namespace of the course, from the parts that name a statement or a session. */
export function derivedId(course: ImportedCourse, ...parts: readonly string[]): string {
  return deriveStatementId(course.idNamespace, JSON.stringify(parts));
}

/** The context of a statement of the LMS: the registration, the category of cmi5, the publisher id and the session. */
function contextOf(
  registration: string,
  publisherId: string,
  session: string,
  extra: { readonly moveOn?: boolean; readonly extensions?: Readonly<Record<string, unknown>> } = {},
) {
  return {
    registration,
    contextActivities: {
      category: [{ id: CMI5_CATEGORIES.cmi5 }, ...(extra.moveOn === true ? [{ id: CMI5_CATEGORIES.moveOn }] : [])],
      grouping: [{ id: publisherId }],
    },
    extensions: { [CMI5_EXTENSIONS.sessionId]: session, ...extra.extensions },
  };
}

/**
 * Builds the launched statement of a session: the launch mode, the URL of the unit without the parameters of the launch,
 * `moveOn`, and the launch parameters and the mastery score when the launch data have them (9.3.1, 9.6.3).
 */
export function launchedStatement(
  course: ImportedCourse,
  au: ImportedAu,
  session: Pick<Session, "id" | "registration" | "actor" | "launchedAt">,
  launchData: LaunchData,
  launchUrl: string,
): Statement {
  return buildStatement(
    {
      id: derivedId(course, "launched", session.id),
      actor: session.actor,
      verb: { id: CMI5_VERBS.launched, display: { "en-US": "launched" } },
      object: { objectType: "Activity", id: au.lmsId },
      context: contextOf(session.registration, au.publisherId, session.id, {
        extensions: {
          [CMI5_EXTENSIONS.launchMode]: launchData.launchMode,
          [CMI5_EXTENSIONS.launchUrl]: launchUrl,
          [CMI5_EXTENSIONS.moveOn]: launchData.moveOn,
          ...(launchData.launchParameters === undefined
            ? {}
            : { [CMI5_EXTENSIONS.launchParameters]: launchData.launchParameters }),
          ...(launchData.masteryScore === undefined ? {} : { [CMI5_EXTENSIONS.masteryScore]: launchData.masteryScore }),
        },
      }),
      timestamp: formatTimestamp(session.launchedAt),
    },
    XAPI_VERSION,
  );
}

/**
 * Builds the abandoned statement of a session, timed at its end, with the duration from the launch to the last statement of
 * the unit, both by the clock of the LMS (9.3.6, 9.5.4.2).
 */
export function abandonedStatement(course: ImportedCourse, au: ImportedAu, session: Session): Statement {
  const endedAt = session.endedAt ?? session.launchedAt;
  const last = Math.max(session.lastStatementAt ?? session.launchedAt, session.launchedAt);
  return buildStatement(
    {
      id: derivedId(course, "abandoned", session.id),
      actor: session.actor,
      verb: { id: CMI5_VERBS.abandoned, display: { "en-US": "abandoned" } },
      object: { objectType: "Activity", id: au.lmsId },
      result: { duration: formatDuration(last - session.launchedAt) },
      context: contextOf(session.registration, au.publisherId, session.id),
      timestamp: formatTimestamp(endedAt),
    },
    XAPI_VERSION,
  );
}

/**
 * Builds the waived statement of an assignable unit in a registration: success and completion, the reason, the category of
 * `moveOn`, and a session id of its own (9.3.7, 9.5.5.2).
 */
export function waivedStatement(
  course: ImportedCourse,
  au: ImportedAu,
  registration: { readonly id: string; readonly actor: Agent },
  reason: string,
  session: string,
  time: number,
): Statement {
  return buildStatement(
    {
      id: derivedId(course, "waived", registration.id, au.publisherId),
      actor: registration.actor,
      verb: { id: CMI5_VERBS.waived, display: { "en-US": "waived" } },
      object: { objectType: "Activity", id: au.lmsId },
      result: { success: true, completion: true, extensions: { [CMI5_EXTENSIONS.reason]: reason } },
      context: contextOf(registration.id, au.publisherId, session, { moveOn: true }),
      timestamp: formatTimestamp(time),
    },
    XAPI_VERSION,
  );
}

/** A block or the course that a registration satisfied. */
export interface Satisfiable {
  readonly kind: "block" | "course";
  readonly publisherId: string;
  readonly lmsId: string;
}

/**
 * Builds the satisfied statement of a block or of the course: its id of the LMS as the object, with the type of a block or of
 * a course, and its publisher id in `grouping` (9.3.9, 9.6.2.3).
 */
export function satisfiedStatement(
  course: ImportedCourse,
  target: Satisfiable,
  registration: { readonly id: string; readonly actor: Agent },
  session: string,
  time: number,
): Statement {
  return buildStatement(
    {
      id: derivedId(course, "satisfied", registration.id, target.lmsId),
      actor: registration.actor,
      verb: { id: CMI5_VERBS.satisfied, display: { "en-US": "satisfied" } },
      object: {
        objectType: "Activity",
        id: target.lmsId,
        definition: { type: CMI5_ACTIVITY_TYPES[target.kind] },
      },
      context: contextOf(registration.id, target.publisherId, session),
      timestamp: formatTimestamp(time),
    },
    XAPI_VERSION,
  );
}
