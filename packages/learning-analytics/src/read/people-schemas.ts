import { jsonObjectSchema } from "@interopkit/core/checks";
import * as v from "valibot";
import { AGENT_TYPES, ORGANIZATION_TYPES, ROLES, STATUSES } from "../model/index.js";
import { entityEntries, entityRecord } from "./entity-record.js";
import { duration, term, text, time } from "./primitives.js";
import type { RangeFactory } from "./range.js";

/**
 * Makes the schemas of the agents, the memberships and the sessions: the classes that name who acts and in what setting.
 *
 * @param to - Makes the schema of a range of entities.
 */
export function peopleSchemas(to: RangeFactory) {
  const agent = entityEntries(to);
  const organization = {
    ...agent,
    subOrganizationOf: v.optional(to(ORGANIZATION_TYPES)),
    members: v.optional(v.array(to(AGENT_TYPES))),
  };
  const courseOffering = { ...organization, courseNumber: v.optional(text), academicSession: v.optional(text) };
  const session = {
    ...agent,
    user: v.optional(to(["Person"])),
    client: v.optional(to(["SoftwareApplication"])),
    startedAtTime: v.optional(time),
    endedAtTime: v.optional(time),
    duration: v.optional(duration),
  };
  return {
    Agent: entityRecord("Agent", agent),
    Person: entityRecord("Person", agent),
    Organization: entityRecord("Organization", organization),
    CourseOffering: entityRecord("CourseOffering", courseOffering),
    CourseSection: entityRecord("CourseSection", { ...courseOffering, category: v.optional(text) }),
    Group: entityRecord("Group", organization),
    Library: entityRecord("Library", {
      ...organization,
      buildingName: v.optional(text),
      buildingNumber: v.optional(text),
    }),
    SoftwareApplication: entityRecord("SoftwareApplication", {
      ...agent,
      host: v.optional(text),
      ipAddress: v.optional(text),
      userAgent: v.optional(text),
      version: v.optional(text),
    }),
    Membership: entityRecord("Membership", {
      ...agent,
      organization: v.optional(to(ORGANIZATION_TYPES)),
      member: v.optional(to(["Person"])),
      roles: v.optional(v.array(term(ROLES, "a role"))),
      status: v.optional(term(STATUSES, "a status")),
    }),
    Session: entityRecord("Session", session),
    LtiSession: entityRecord("LtiSession", { ...session, messageParameters: v.optional(jsonObjectSchema) }),
  };
}
