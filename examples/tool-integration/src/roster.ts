import type { Group, GroupSet, Member, PreferencesRecord } from "@interopkit/tool-integration";
import type {
  GroupStore,
  PreferencesStore,
  RosterStore,
  ServiceCaller,
  StorePage,
} from "@interopkit/tool-integration/platform";

const INSTRUCTOR = "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";
const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";

/** What the platform keeps of one course for the services of the roster, and the tool whose course it is. */
export interface Course {
  /** The tool whose course this is; another tool sees none. */
  readonly clientId: string;
  readonly contextId: string;
  readonly members: readonly Member[];
  readonly groups: readonly Group[];
  readonly sets: readonly GroupSet[];
  /** The record of the needs and preferences of each user for each activity, by `user/activity`. */
  readonly records: ReadonlyMap<string, PreferencesRecord>;
}

/** The stores of the three services of the roster over one course. */
export interface RosterStores {
  readonly roster: RosterStore;
  readonly groups: GroupStore;
  readonly preferences: PreferencesStore;
}

/** The course of the example: an instructor and two learners, one of them in a group, and a record of needs for one activity. */
export function courseOf(clientId: string): Course {
  return {
    clientId,
    contextId: "course-1",
    members: [
      { userId: "instructor-1", roles: [INSTRUCTOR], name: "Ibu Sari" },
      { userId: "candidate-7", roles: [LEARNER], name: "Ana Candidate", groupEnrollments: [{ groupId: "group-a" }] },
      { userId: "candidate-8", roles: [LEARNER], name: "Budi Candidate" },
    ],
    groups: [{ id: "group-a", name: "Drawing group A", setIds: ["lab"] }],
    sets: [{ id: "lab", name: "Drawing lab" }],
    records: new Map([["candidate-7/session-1-question-4", { "additional-testing-time": { "time-factor": 1.5 } }]]),
  };
}

/** Pages a list the way a store does: the cursor is the offset of the next page. */
function pageOf<T>(items: readonly T[], query: { readonly limit: number; readonly cursor?: string }): StorePage<T> {
  const start = Number(query.cursor ?? 0);
  const end = start + query.limit;
  return { items: items.slice(start, end), ...(end < items.length ? { cursor: String(end) } : {}) };
}

/**
 * Creates the stores of the three services over a course in memory. A real host keeps them in its database, and decides for each
 * call which users and activities the tool may see: every method receives the caller, and a course that is not the caller's is
 * `undefined`, which the platform answers with 404.
 */
export function createRosterStores(course: Course): RosterStores {
  const own = (caller: ServiceCaller, contextId: string): boolean =>
    caller.clientId === course.clientId && contextId === course.contextId;
  return {
    roster: {
      async members(caller, contextId, query) {
        if (!own(caller, contextId)) return undefined;
        const members = course.members.filter(
          (member) => query.role === undefined || member.roles.includes(query.role),
        );
        return { ...pageOf(members, query), context: { label: "DRAW 101", title: "Tryout" } };
      },
    },
    groups: {
      async groups(caller, contextId, query) {
        if (!own(caller, contextId)) return undefined;
        const enrolled = course.members.find((member) => member.userId === query.userId)?.groupEnrollments ?? [];
        const groups =
          query.userId === undefined
            ? course.groups
            : course.groups.filter((group) => enrolled.some(({ groupId }) => groupId === group.id));
        return pageOf(groups, query);
      },
      async groupSets(caller, contextId, query) {
        return own(caller, contextId) ? pageOf(course.sets, query) : undefined;
      },
    },
    preferences: {
      async record(caller, userSourcedId, activityId) {
        return caller.clientId === course.clientId ? course.records.get(`${userSourcedId}/${activityId}`) : undefined;
      },
    },
  };
}
