import type { CallOptions } from "@interopkit/core";
import type { JsonObject } from "@interopkit/core/checks";
import type { Group, GroupSet, Member } from "../src/index.js";
import type {
  GroupStore,
  PreferencesStore,
  RosterStore,
  ServiceCaller,
  StoreGroupQuery,
  StoreMemberPage,
  StoreMemberQuery,
  StorePage,
} from "../src/platform/index.js";

export const INSTRUCTOR = "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";
export const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";

/** One call to a store: the method, the caller, the other arguments without the options, and the signal. */
export interface StoreCall {
  readonly method: string;
  readonly caller: ServiceCaller;
  readonly args: readonly unknown[];
  readonly signal: AbortSignal | undefined;
}

/** The message of a resource link that a roster gives for a member. */
const MESSAGE = [
  {
    "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
    "https://purl.imsglobal.org/spec/lti/claim/custom": { country: "Canada" },
  },
];

/**
 * A roster in memory for the tests of Names and Role Provisioning: one course of members in order, the resource links of it, and
 * the members that left. It gives more than a request asks for, the group enrollments and the message of a link on every
 * member, so that a test sees the platform keep back what the tool did not ask for. It records every call.
 */
export class MemoryRoster implements RosterStore {
  /** The client whose course this is; another caller sees none. */
  owner: string;
  readonly contextId = "course-1";
  readonly people: Member[] = [
    { userId: "jane", roles: [INSTRUCTOR], name: "Jane M. Doe", email: "jane@platform.example.edu" },
    { userId: "ana", roles: [LEARNER], lti11LegacyUserId: "legacy-ana" },
    { userId: "budi", roles: [LEARNER], groupEnrollments: [{ groupId: "g1" }, { groupId: "g2" }] },
    { userId: "citra", roles: [LEARNER] },
  ];
  /** The members of each resource link of the course, by its identifier. */
  readonly links = new Map<string, readonly string[]>([["link-1", ["ana", "budi"]]]);
  readonly calls: StoreCall[] = [];
  /** The token that a read of the differences returns, and the one the store gives with every page. */
  readonly since = "t1";
  differences: string | undefined = "t2";
  /** The label and title of the course. */
  context: StoreMemberPage["context"] = { label: "CPS 435", title: "CPS 435 Learning Analytics" };

  constructor(owner: string) {
    this.owner = owner;
  }

  async members(
    caller: ServiceCaller,
    contextId: string,
    query: StoreMemberQuery,
    options?: CallOptions,
  ): Promise<StoreMemberPage | undefined> {
    this.calls.push({ method: "members", caller, args: [contextId, query], signal: options?.signal });
    if (caller.clientId !== this.owner || contextId !== this.contextId) return undefined;
    let people: Member[] = this.people.map((member) => ({
      ...member,
      groupEnrollments: member.groupEnrollments ?? [{ groupId: "g3" }],
      message: MESSAGE,
    }));
    if (query.resourceLinkId !== undefined) {
      const ids = this.links.get(query.resourceLinkId);
      if (ids === undefined) return undefined;
      people = people.filter((member) => ids.includes(member.userId));
    }
    if (query.role !== undefined) people = people.filter((member) => member.roles.includes(query.role ?? ""));
    if (query.since === this.since) people = [{ userId: "left", roles: [LEARNER], status: "Deleted" }];
    else if (query.since !== undefined) return undefined;
    const start = query.cursor === undefined ? 0 : Number(query.cursor);
    if (!Number.isSafeInteger(start)) return undefined;
    const end = start + query.limit;
    return {
      items: people.slice(start, end),
      ...(end < people.length ? { cursor: String(end) } : {}),
      ...(this.differences === undefined ? {} : { differences: this.differences }),
      ...(this.context === undefined ? {} : { context: this.context }),
    };
  }
}

/** The groups of one course in memory, and the groups that each user is enrolled in; it records every call. */
export class MemoryGroups implements GroupStore {
  owner: string;
  readonly contextId = "course-1";
  readonly groups_: Group[] = [
    { id: "g1", name: "Tuesday", setIds: ["s1"], tag: "marking" },
    { id: "g2", name: "Friday", setIds: ["s1", "s2"], hidden: true },
    { id: "g3", name: "Cool kids" },
  ];
  readonly sets: GroupSet[] = [
    { id: "s1", name: "Chemistry lab" },
    { id: "s2", name: "Sections", tag: "http://purl.imsglobal.org/vocab/lis/v2/course#CourseSection" },
  ];
  /** The groups of each user. */
  readonly enrolled = new Map<string, readonly string[]>([["budi", ["g1", "g2"]]]);
  readonly calls: StoreCall[] = [];

  constructor(owner: string) {
    this.owner = owner;
  }

  private page<T>(items: readonly T[], query: { readonly limit: number; readonly cursor?: string }): StorePage<T> {
    const start = query.cursor === undefined ? 0 : Number(query.cursor);
    const end = start + query.limit;
    return { items: items.slice(start, end), ...(end < items.length ? { cursor: String(end) } : {}) };
  }

  async groups(
    caller: ServiceCaller,
    contextId: string,
    query: StoreGroupQuery,
    options?: CallOptions,
  ): Promise<StorePage<Group> | undefined> {
    this.calls.push({ method: "groups", caller, args: [contextId, query], signal: options?.signal });
    if (caller.clientId !== this.owner || contextId !== this.contextId) return undefined;
    const ids = query.userId === undefined ? undefined : (this.enrolled.get(query.userId) ?? []);
    return this.page(
      this.groups_.filter((group) => ids === undefined || ids.includes(group.id)),
      query,
    );
  }

  async groupSets(
    caller: ServiceCaller,
    contextId: string,
    query: { readonly limit: number; readonly cursor?: string },
    options?: CallOptions,
  ): Promise<StorePage<GroupSet> | undefined> {
    this.calls.push({ method: "groupSets", caller, args: [contextId, query], signal: options?.signal });
    if (caller.clientId !== this.owner || contextId !== this.contextId) return undefined;
    return this.page(this.sets, query);
  }
}

/** The records of the AfA PNP Connector in memory, by user and activity; it gives every member whatever `fields` asks for. */
export class MemoryPreferences implements PreferencesStore {
  owner: string;
  readonly records = new Map<string, JsonObject>([
    [
      "ana\u0000activity-1",
      { "language-of-interface": "id", "additional-testing-time": { "time-factor": 1.5 }, encouragement: true },
    ],
  ]);
  readonly calls: StoreCall[] = [];

  constructor(owner: string) {
    this.owner = owner;
  }

  async record(
    caller: ServiceCaller,
    userSourcedId: string,
    activityId: string,
    fields: readonly string[] | undefined,
    options?: CallOptions,
  ): Promise<JsonObject | undefined> {
    this.calls.push({ method: "record", caller, args: [userSourcedId, activityId, fields], signal: options?.signal });
    return caller.clientId === this.owner ? this.records.get(`${userSourcedId}\u0000${activityId}`) : undefined;
  }
}
