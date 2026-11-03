import { readClock } from "@interopkit/core";
import { isUuid } from "@interopkit/core/checks";
import type { Statement } from "@interopkit/learning-records";
import { CMI5_EXTENSIONS } from "../model/index.js";
import { courseOf, registrationOf } from "./create-registration.js";
import { type LmsSettings, signalOf, withRetries } from "./options.js";
import { auOf } from "./progress.js";
import type { Registration, RegistrationAu, Reservation, Session } from "./records.js";
import { satisfy } from "./satisfy.js";

/** Lists the ids of the statements of each session id that their contexts name. */
function bySession(statements: readonly Statement[]): ReadonlyMap<string, ReadonlySet<string>> {
  const sessions = new Map<string, Set<string>>();
  for (const statement of statements) {
    const session = statement.context?.extensions?.[CMI5_EXTENSIONS.sessionId];
    if (typeof session !== "string" || !isUuid(session) || statement.id === undefined) continue;
    const ids = sessions.get(session.toLowerCase()) ?? new Set<string>();
    ids.add(statement.id.toLowerCase());
    sessions.set(session.toLowerCase(), ids);
  }
  return sessions;
}

/** Marks the completed and passed statements of a unit as stored, when they are those given. */
function markStored(au: RegistrationAu, stored: readonly Reservation[]): RegistrationAu {
  let marked = au;
  for (const { verb, statement } of stored) {
    if ((verb === "completed" || verb === "passed") && marked[verb]?.statement === statement) {
      marked = { ...marked, [verb]: { statement, stored: true } };
    }
  }
  return marked;
}

/** Records the stored outcomes of a session in its registration and writes the satisfied statements that they make due. */
async function recordOutcomes(settings: LmsSettings, session: Session, stored: readonly Reservation[]): Promise<void> {
  await withRetries(settings, "recorded the outcomes of a session", async () => {
    const registration = await registrationOf(settings, session.registration);
    const unit = markStored(auOf(registration, session.au), stored);
    const marked: Registration = { ...registration, aus: { ...registration.aus, [session.au]: unit } };
    const course = await courseOf(settings, registration.course);
    const satisfied = await satisfy(settings, course, marked, session.id);
    const put = await settings.store.putRegistration(
      { ...satisfied, revision: registration.revision + 1 },
      registration.revision,
      signalOf(settings),
    );
    return put === "written" ? "done" : "conflict";
  });
}

/** Ends a session whose terminated statement the LRS stored: its token is refused from then on (9.3.8). */
async function terminate(settings: LmsSettings, id: string): Promise<void> {
  await withRetries(settings, "terminated a session", async () => {
    const session = await settings.store.session(id, signalOf(settings));
    if (session?.state !== "active") return "done";
    const put = await settings.store.putSession(
      { ...session, state: "terminated", endedAt: readClock(settings.clock), revision: session.revision + 1 },
      session.revision,
      signalOf(settings),
    );
    return put === "written" ? "done" : "conflict";
  });
}

/**
 * Acts on the statements that the LRS stored, or holds already for a resend: for those that `accept` reserved in a session, it
 * records their completed and passed statements as stored, writes the satisfied statements that they make due, and ends the
 * session at its terminated statement. Statements that no session reserved, those of the host's credentials and of the LMS
 * itself among them, change nothing.
 */
export async function afterStore(settings: LmsSettings, statements: readonly Statement[]): Promise<void> {
  for (const [id, ids] of bySession(statements)) {
    const session = await settings.store.session(id, signalOf(settings));
    const stored = session?.reserved.filter(({ statement }) => ids.has(statement)) ?? [];
    if (session === undefined || stored.length === 0) continue;
    if (stored.some(({ verb }) => verb === "completed" || verb === "passed")) {
      await recordOutcomes(settings, session, stored);
    }
    if (stored.some(({ verb }) => verb === "terminated")) await terminate(settings, id);
  }
}
