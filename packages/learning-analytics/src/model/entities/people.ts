import type { JsonObject } from "@interopkit/core/checks";
import type { CaliperRole, CaliperStatus } from "../internal.js";
import type { Entity, Ref } from "./entity.js";
import type { AnyAgent, AnyOrganization } from "./ranges.js";

/**
 * An agent: an entity that can initiate or perform an action (Caliper 1.2 B.1). A sender uses the generic type only when no
 * subtype fits.
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface Agent<TType extends string = "Agent"> extends Entity<TType> {}

/** A human being (Caliper 1.2 B.46). */
export interface Person extends Agent<"Person"> {}

/**
 * A formal collection of people with a common purpose, such as an institution or a school (Caliper 1.2 B.44). It can act as an
 * agent.
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface Organization<TType extends string = "Organization"> extends Agent<TType> {
  /** The organization that this one belongs to. */
  readonly subOrganizationOf?: Ref<AnyOrganization>;
  /** The agents that belong to the organization. */
  readonly members?: readonly Ref<AnyAgent>[];
}

/**
 * A course in a period of time (Caliper 1.2 B.14).
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface CourseOffering<TType extends string = "CourseOffering"> extends Organization<TType> {
  /** A readable identifier of the course, such as its catalog number. */
  readonly courseNumber?: string;
  /** A readable name of the period in which the course takes place. */
  readonly academicSession?: string;
}

/** One section of a course offering in a term (Caliper 1.2 B.15). */
export interface CourseSection extends CourseOffering<"CourseSection"> {
  /** What the section is for, such as a lecture, a lab or a seminar. */
  readonly category?: string;
}

/** An informal or short-lived collection of people with a common purpose (Caliper 1.2 B.24). */
export interface Group extends Organization<"Group"> {}

/** A library, archive, museum or another institution of cultural memory, or a part of one (Library Use Profile 5.1). */
export interface Library extends Organization<"Library"> {
  /** The name of the building that houses the library. */
  readonly buildingName?: string;
  /** The number of the building that houses the library. */
  readonly buildingNumber?: string;
}

/** A program, application, module, platform or system (Caliper 1.2 B.62). */
export interface SoftwareApplication extends Agent<"SoftwareApplication"> {
  /** The host of the application, such as the back-end service behind a front-end web application. */
  readonly host?: string;
  /** The IPv4 or IPv6 address of the application. */
  readonly ipAddress?: string;
  /** The description of the user agent that hosts the application, such as the string a browser reports. */
  readonly userAgent?: string;
  /** The current form or version of the application. */
  readonly version?: string;
}

/** The relationship between an organization and a member, with the roles and the standing of the member (Caliper 1.2 B.34). */
export interface Membership extends Entity<"Membership"> {
  /** The organization that the member belongs to. */
  readonly organization?: Ref<AnyOrganization>;
  /** The person who is the member. */
  readonly member?: Ref<Person>;
  /** The roles of the member in the organization; a sub-role goes with its core role. */
  readonly roles?: readonly CaliperRole[];
  /** The standing of the member. */
  readonly status?: CaliperStatus;
}

/**
 * The session of a user in a web application (Caliper 1.2 B.60).
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface Session<TType extends string = "Session"> extends Entity<TType> {
  /** The person who started the session. */
  readonly user?: Ref<Person>;
  /** The application that hosts the session. */
  readonly client?: Ref<SoftwareApplication>;
  /** When the session started, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly startedAtTime?: string;
  /** When the session ended, in the same form. */
  readonly endedAtTime?: string;
  /** How long the session lasted, as an ISO 8601 duration. */
  readonly duration?: string;
}

/** The session of a user on an LTI platform (Caliper 1.2 B.31). */
export interface LtiSession extends Session<"LtiSession"> {
  /** The LTI message parameters that give the platform context of the session. */
  readonly messageParameters?: JsonObject;
}
