import type { CaliperEntity } from "./entity.js";
import type { CaliperAction, CaliperEventType, CaliperProfile } from "./event.js";

/** The terms of the event types, which the type `CaliperEventType` names. */
export const EVENT_TYPES = [
  "AssessmentEvent",
  "AssessmentItemEvent",
  "NavigationEvent",
  "GradeEvent",
] as const satisfies readonly CaliperEventType[];

/** The terms of the profiles, which the type `CaliperProfile` names. */
export const PROFILES = ["AssessmentProfile", "GradingProfile"] as const satisfies readonly CaliperProfile[];

/** The terms of the actions, which the type `CaliperAction` names. */
export const ACTIONS = [
  "Started",
  "Paused",
  "Resumed",
  "Submitted",
  "Skipped",
  "Completed",
  "NavigatedTo",
  "Graded",
] as const satisfies readonly CaliperAction[];

/** The terms of the entity types, which the `type` of `CaliperEntity` names. */
export const ENTITY_TYPES = [
  "Person",
  "SoftwareApplication",
  "Assessment",
  "AssessmentItem",
  "Attempt",
  "Score",
] as const satisfies readonly CaliperEntity["type"][];
