// biome-ignore-all lint/style/useNamingConvention: The terms of Caliper are those of its specification.

import { describe, expect, it } from "vitest";
import {
  CALIPER_CONTEXT,
  type CaliperAction,
  type CaliperEntity,
  type CaliperEventType,
  type CaliperProfile,
} from "../src/index.js";
import { ACTIONS, ENTITY_TYPES, EVENT_TYPES, PROFILES } from "../src/model/internal.js";

// A record over a type must name every member, so that a term added to the type fails the check of the types until the
// list of terms and this test follow it.
const EVENT_TYPE_NAMES: Readonly<Record<CaliperEventType, true>> = {
  AssessmentEvent: true,
  AssessmentItemEvent: true,
  NavigationEvent: true,
  GradeEvent: true,
};
const PROFILE_NAMES: Readonly<Record<CaliperProfile, true>> = { AssessmentProfile: true, GradingProfile: true };
const ACTION_NAMES: Readonly<Record<CaliperAction, true>> = {
  Started: true,
  Paused: true,
  Resumed: true,
  Submitted: true,
  Skipped: true,
  Completed: true,
  NavigatedTo: true,
  Graded: true,
};
const ENTITY_TYPE_NAMES: Readonly<Record<CaliperEntity["type"], true>> = {
  Person: true,
  SoftwareApplication: true,
  Assessment: true,
  AssessmentItem: true,
  Attempt: true,
  Score: true,
};

describe("the model", () => {
  it("names the context of Caliper 1.2", () => {
    expect(CALIPER_CONTEXT).toBe("http://purl.imsglobal.org/ctx/caliper/v1p2");
  });

  it("lists as terms exactly the members of the types of events, profiles, actions and entities", () => {
    expect([...EVENT_TYPES].sort()).toStrictEqual(Object.keys(EVENT_TYPE_NAMES).sort());
    expect([...PROFILES].sort()).toStrictEqual(Object.keys(PROFILE_NAMES).sort());
    expect([...ACTIONS].sort()).toStrictEqual(Object.keys(ACTION_NAMES).sort());
    expect([...ENTITY_TYPES].sort()).toStrictEqual(Object.keys(ENTITY_TYPE_NAMES).sort());
  });
});
