import { readClock } from "@interopkit/core";
import type { Statement } from "@interopkit/learning-records";
import { type Satisfiable, satisfiedStatement } from "./lms-statements.js";
import { type LmsSettings, signalOf } from "./options.js";
import { dueSatisfactions, withSatisfactions, withSatisfiedUnits } from "./progress.js";
import type { ImportedCourse, Registration } from "./records.js";

/**
 * Writes a statement of the LMS once. Its id is derived from what it is, so a call made again sends the same id: the LRS keeps
 * the first, and answers a resend as stored and another statement with that id as a conflict, which both mean it is written.
 */
export async function writeOnce(settings: LmsSettings, statement: Statement): Promise<void> {
  await settings.records.sendStatement(statement, signalOf(settings));
}

/**
 * Marks the satisfied units of a registration and writes the satisfied statements of the blocks and the course that are due,
 * innermost first, with the session id given.
 *
 * @returns The registration with the units, blocks and course marked; the statements are written before it is returned, so a
 * flag never says more than the LRS holds.
 */
export async function satisfy(
  settings: LmsSettings,
  course: ImportedCourse,
  registration: Registration,
  session: string,
): Promise<Registration> {
  const marked = withSatisfiedUnits(registration);
  const due: readonly Satisfiable[] = dueSatisfactions(course, marked);
  for (const target of due) {
    await writeOnce(settings, satisfiedStatement(course, target, marked, session, readClock(settings.clock)));
  }
  return withSatisfactions(marked, due);
}
