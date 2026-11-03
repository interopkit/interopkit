import { DataError, readClock } from "@interopkit/core";
import { isUuid } from "@interopkit/core/checks";
import { courseOf, registrationOf } from "./create-registration.js";
import { abandonedStatement } from "./lms-statements.js";
import { type LmsOptions, type LmsSettings, readLmsOptions, signalOf, withRetries } from "./options.js";
import { auOf } from "./progress.js";
import type { Session } from "./records.js";
import { writeOnce } from "./satisfy.js";

/** Reads a session from the store, which must hold it. */
async function sessionOf(settings: LmsSettings, id: string): Promise<Session> {
  const session = await settings.store.session(id, signalOf(settings));
  if (session === undefined) throw new DataError(`The store holds no session ${JSON.stringify(id)}.`);
  return session;
}

/** Ends a session as abandoned, unless it ended or never launched; returns the session abandoned and whether this call did it. */
async function endSession(
  settings: LmsSettings,
  id: string,
): Promise<{ readonly session: Session; readonly moved: boolean } | undefined> {
  return withRetries(settings, "abandoned a session", async () => {
    const session = await sessionOf(settings, id);
    if (session.state === "abandoned") return { session, moved: false };
    if (session.state !== "launched" && session.state !== "active") return undefined;
    const ended: Session = {
      ...session,
      state: "abandoned",
      endedAt: readClock(settings.clock),
      revision: session.revision + 1,
    };
    const put = await settings.store.putSession(ended, session.revision, signalOf(settings));
    return put === "written" ? { session: ended, moved: true } : "conflict";
  });
}

/** Clears the session of an assignable unit in its registration when it is the one given. */
async function release(settings: LmsSettings, session: Session): Promise<void> {
  await withRetries(settings, "released an abandoned session", async () => {
    const registration = await registrationOf(settings, session.registration);
    const { session: active, ...au } = auOf(registration, session.au);
    if (active !== session.id) return "done";
    const put = await settings.store.putRegistration(
      { ...registration, aus: { ...registration.aus, [session.au]: au }, revision: registration.revision + 1 },
      registration.revision,
      signalOf(settings),
    );
    return put === "written" ? "done" : "conflict";
  });
}

/**
 * Abandons a session: ends it, so that its token is refused from then on, writes its abandoned statement and frees its
 * assignable unit for a new launch.
 *
 * @returns Whether this call ended the session.
 */
export async function abandon(settings: LmsSettings, id: string): Promise<"abandoned" | "already-ended"> {
  const ended = await endSession(settings, id);
  if (ended === undefined) return "already-ended";
  const { session } = ended;
  const registration = await registrationOf(settings, session.registration);
  const course = await courseOf(settings, registration.course);
  const au = course.aus.find(({ publisherId }) => publisherId === session.au);
  if (au === undefined) throw new DataError(`The course ${course.id} has no assignable unit ${session.au}.`);
  // The statement is timed at the end that the record holds, so a call made again sends the same statement.
  await writeOnce(settings, abandonedStatement(course, au, session));
  await release(settings, session);
  return ended.moved ? "abandoned" : "already-ended";
}

/**
 * Abandons a session that its assignable unit did not terminate: the LMS ends it, refuses its token from then on, and writes
 * its abandoned statement, with the duration from the launch to the last statement of the unit.
 *
 * @remarks
 * The session ends first, so that no statement of the unit is taken after the abandoned one (9.3.6). The abandoned statement
 * has an id derived from the session and the time of the end, so a call made again after a failure writes it once. A host
 * calls this when its own rules say a session is over, such as a time without statements; `prepareLaunch` calls it for the
 * active session of a unit that it launches again.
 *
 * @param session - The session id.
 * @param options - The options of the LMS.
 * @returns `"abandoned"`, or `"already-ended"` for a session that was terminated, abandoned or never launched.
 * @throws `DataError` for a session id that is not a UUID or that the store does not hold.
 * @throws What the store or the client of the LRS rejects with, and `InteropkitError` when the store keeps a conflict.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#verbs_abandoned | cmi5, 9.3.6 Abandoned}
 */
export async function abandonSession(session: string, options: LmsOptions): Promise<"abandoned" | "already-ended"> {
  const settings = readLmsOptions(options);
  if (typeof session !== "string" || !isUuid(session)) {
    throw new DataError(`The session must be a UUID, found ${JSON.stringify(session)}.`);
  }
  return abandon(settings, session.toLowerCase());
}
