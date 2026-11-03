import type { Cmi5Store, ImportedCourse, Registration, Session } from "@interopkit/course-launch/lms";

/** The store of an LMS in memory, with the courses that the host imported. */
export interface MemoryCmi5Store extends Cmi5Store {
  /** Keeps a course that `importCourse` returned, by its id. */
  readonly addCourse: (course: ImportedCourse) => void;
}

/** Writes a record when the one held has the revision given, or none is held for `"absent"`: a compare-and-set. */
function putIn<T extends { readonly id: string; readonly revision: number }>(
  records: Map<string, string>,
  record: T,
  revision: number | "absent",
): "written" | "conflict" {
  const held = records.get(record.id);
  const current = held === undefined ? "absent" : (JSON.parse(held) as T).revision;
  if (current !== revision) return "conflict";
  records.set(record.id, JSON.stringify(record));
  return "written";
}

/**
 * Keeps courses, registrations and sessions in memory, as JSON, so that a record that goes in comes out the same and shares
 * nothing with the caller. Every method runs to its end before another starts, so each put is a compare-and-set as the port
 * asks.
 */
export function createMemoryCmi5Store(): MemoryCmi5Store {
  const courses = new Map<string, string>();
  const registrations = new Map<string, string>();
  const sessions = new Map<string, string>();
  const read = <T>(records: Map<string, string>, id: string): T | undefined => {
    const held = records.get(id);
    return held === undefined ? undefined : (JSON.parse(held) as T);
  };
  return {
    addCourse: (course) => {
      courses.set(course.id, JSON.stringify(course));
    },
    course: async (id) => read<ImportedCourse>(courses, id),
    registration: async (id) => read<Registration>(registrations, id),
    putRegistration: async (record, revision) => putIn(registrations, record, revision),
    session: async (id) => read<Session>(sessions, id),
    putSession: async (record, revision) => putIn(sessions, record, revision),
  };
}
