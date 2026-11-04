import type { CallOptions } from "@interopkit/core";
import type { Agent } from "@interopkit/learning-records";
import type { AuVerb, CourseStructure, LaunchData, LaunchMethod, MoveOn } from "../model/index.js";

/** An assignable unit of a course that an LMS imported: its ids, its launch and where it sits. */
export interface ImportedAu {
  /** The `id` of the unit in the course structure, which the publisher gave. */
  readonly publisherId: string;
  /** The id that the LMS made for the unit: the `activityId` of its launches and the object of its statements. */
  readonly lmsId: string;
  /** The absolute URL of the unit, a relative one resolved against the content base of the import. */
  readonly url: string;
  /** The window the unit runs in. */
  readonly launchMethod: LaunchMethod;
  /** What satisfies the unit, as the course structure says. */
  readonly moveOn: MoveOn;
  /**
   * The scaled score at which the learner passes.
   *
   * @defaultValue none
   */
  readonly masteryScore?: number;
  /**
   * The static parameters of its launches.
   *
   * @defaultValue none
   */
  readonly launchParameters?: string;
  /**
   * The entitlement key of the course structure.
   *
   * @defaultValue none
   */
  readonly entitlementKey?: string;
  /** The publisher ids of the blocks that hold the unit, the innermost first. */
  readonly blocks: readonly string[];
}

/** A block of a course that an LMS imported. */
export interface ImportedBlock {
  /** The `id` of the block in the course structure. */
  readonly publisherId: string;
  /** The id that the LMS made for the block: the object of its satisfied statements. */
  readonly lmsId: string;
  /** The publisher ids of the assignable units and blocks directly in it. */
  readonly members: readonly string[];
  /** The publisher ids of the blocks that hold it, the innermost first. */
  readonly blocks: readonly string[];
}

/**
 * A course as an LMS holds it after `importCourse`: the structure, and the ids that the LMS made for the course, its blocks and
 * its assignable units, each in the order of the structure.
 */
export interface ImportedCourse {
  /** The id that the host gave the course. */
  readonly id: string;
  /** The UUID under which the ids of the LMS and of its statements are made. */
  readonly idNamespace: string;
  /** The `id` of the course in the course structure. */
  readonly publisherId: string;
  /** The id that the LMS made for the course: the object of its satisfied statements. */
  readonly lmsId: string;
  /** The publisher ids of the assignable units and blocks directly in the course. */
  readonly members: readonly string[];
  /** The assignable units, in the order of the structure: the index of a unit is its place in this list. */
  readonly aus: readonly ImportedAu[];
  /** The blocks, in the order of the structure. */
  readonly blocks: readonly ImportedBlock[];
  /** The course structure as it was imported, for a host that writes it again. */
  readonly structure: CourseStructure;
}

/** A completed or a passed statement of a registration: its id, and whether the LRS stored it. */
export interface AuOutcome {
  /** The id of the statement. */
  readonly statement: string;
  /** Whether the LRS stored it: an outcome counts towards satisfaction once it is stored. */
  readonly stored: boolean;
}

/** What a registration holds for one assignable unit. */
export interface RegistrationAu {
  /** What satisfies the unit: the course structure's, or that of its latest launch. */
  readonly moveOn: MoveOn;
  /**
   * The completed statement of the registration.
   *
   * @defaultValue none
   */
  readonly completed?: AuOutcome;
  /**
   * The passed statement of the registration.
   *
   * @defaultValue none
   */
  readonly passed?: AuOutcome;
  /**
   * The waived statement that the LMS wrote, and its reason.
   *
   * @defaultValue none
   */
  readonly waived?: {
    /** The id of the waived statement. */
    readonly statement: string;
    /** Why the LMS waived the unit. */
    readonly reason: string;
  };
  /** Whether the unit is satisfied. */
  readonly satisfied: boolean;
  /**
   * The id of the session that is launched or active.
   *
   * @defaultValue none
   */
  readonly session?: string;
}

/** A registration: one learner in one course, with what each assignable unit, block and the course hold. */
export interface Registration {
  /** The registration, a UUID. */
  readonly id: string;
  /** The id of the course that the host gave at import. */
  readonly course: string;
  /** The learner, an Agent with an account. */
  readonly actor: Agent;
  /** The revision of the record, 1 when it is made, one more at each write. */
  readonly revision: number;
  /** What each assignable unit holds, by its publisher id. */
  readonly aus: Readonly<Record<string, RegistrationAu>>;
  /** The publisher ids of the blocks whose satisfied statement the LMS wrote. */
  readonly satisfiedBlocks: readonly string[];
  /** Whether the LMS wrote the satisfied statement of the course. */
  readonly satisfied: boolean;
}

/**
 * The states of a session: made, launched, active once the assignable unit fetched its token, and ended by its terminated
 * statement or by the LMS.
 */
export const SESSION_STATES = ["preparing", "launched", "active", "terminated", "abandoned"] as const;

/** The state of a session. */
export type SessionState = (typeof SESSION_STATES)[number];

/** A statement that cmi5 defines, which the LMS took from an assignable unit in a session. */
export interface Reservation {
  /** The verb, by name: initialized, completed, passed, failed or terminated. */
  readonly verb: AuVerb;
  /** The id of the statement. */
  readonly statement: string;
  /** The `timestamp` of the statement, in milliseconds. */
  readonly time: number;
}

/** A session: one launch of an assignable unit in a registration. */
export interface Session {
  /** The session id, a UUID: the `sessionid` extension of every statement of the session. */
  readonly id: string;
  /** The registration of the launch. */
  readonly registration: string;
  /** The publisher id of the assignable unit. */
  readonly au: string;
  /** The id of the activity of the unit that the LMS made, the `activityId` of the launch. */
  readonly activityId: string;
  /** The learner. */
  readonly actor: Agent;
  /** The revision of the record, 1 when it is made, one more at each write. */
  readonly revision: number;
  /** The state of the session. */
  readonly state: SessionState;
  /** The `LMS.LaunchData` of the launch. */
  readonly launchData: LaunchData;
  /** The SHA-256 of the secret of the fetch URL, in base64url. */
  readonly fetchCode: string;
  /**
   * The SHA-256 of the secret of the authorization token, in base64url, once the assignable unit fetched it.
   *
   * @defaultValue none
   */
  readonly token?: string;
  /** When the LMS launched the unit, in milliseconds by its clock. */
  readonly launchedAt: number;
  /**
   * When the unit fetched its token, in milliseconds by the clock of the LMS.
   *
   * @defaultValue none
   */
  readonly fetchedAt?: number;
  /**
   * When the last statement of the unit arrived, in milliseconds by the clock of the LMS.
   *
   * @defaultValue none
   */
  readonly lastStatementAt?: number;
  /**
   * When the session ended, in milliseconds by the clock of the LMS.
   *
   * @defaultValue none
   */
  readonly endedAt?: number;
  /** The statements that cmi5 defines which the LMS took in the session, in the order it took them. */
  readonly reserved: readonly Reservation[];
  /** Whether the unit read the preferences of the learner. */
  readonly preferencesRead: boolean;
}

/** What a conditional write of a record did: it wrote, or another revision was stored and nothing was written. */
export type PutOutcome = "written" | "conflict";

/**
 * Where an LMS keeps its courses, registrations and sessions.
 *
 * @remarks
 * A method may be called again and from several requests at once, rejects when it fails, and receives the `signal` of the call.
 * A put is atomic across processes: it writes the record only when the stored record has the revision given, or, with
 * `"absent"`, when there is none, and says `"conflict"` otherwise. The LMS reads the record again after a conflict and makes
 * its change on the record that won. A record goes into the store as the LMS made it and comes out the same: JSON keeps it.
 */
export interface Cmi5Store {
  /** Returns the course that the host imported with this id, or `undefined`. */
  course(id: string, options?: CallOptions): Promise<ImportedCourse | undefined>;
  /** Returns the registration, or `undefined`. */
  registration(id: string, options?: CallOptions): Promise<Registration | undefined>;
  /** Writes the registration when the stored one has the revision given, or none is stored for `"absent"`. */
  putRegistration(record: Registration, revision: number | "absent", options?: CallOptions): Promise<PutOutcome>;
  /** Returns the session, or `undefined`. */
  session(id: string, options?: CallOptions): Promise<Session | undefined>;
  /** Writes the session when the stored one has the revision given, or none is stored for `"absent"`. */
  putSession(record: Session, revision: number | "absent", options?: CallOptions): Promise<PutOutcome>;
}
