import type { CALIPER_CONTEXT } from "./context.js";
import type { CaliperEntity } from "./entity.js";

/** The terms of the Caliper events that this version builds (Caliper 1.2 sections 3.2 and 3.6). */
export type CaliperEventType = "AssessmentEvent" | "AssessmentItemEvent" | "NavigationEvent" | "GradeEvent";

/** The profile that governs an event (Caliper 1.2 section 2.1, Appendix E). */
export type CaliperProfile = "AssessmentProfile" | "GradingProfile";

/** The actions of the events that this version builds (Caliper 1.2 Appendix D). */
export type CaliperAction =
  | "Started"
  | "Paused"
  | "Resumed"
  | "Submitted"
  | "Skipped"
  | "Completed"
  | "NavigatedTo"
  | "Graded";

/** A Caliper event as JSON-LD (Caliper 1.2 section 2.1). */
export interface CaliperEvent {
  /** The Caliper context, `CALIPER_CONTEXT`. */
  readonly "@context": typeof CALIPER_CONTEXT;
  /** A name-based UUID as a URN: `urn:uuid:<UUID>`. */
  readonly id: string;
  /** The term of the event's type. */
  readonly type: CaliperEventType;
  /** The profile that governs the event. */
  readonly profile: CaliperProfile;
  /** The agent who acted. */
  readonly actor: CaliperEntity;
  /** What the actor did. */
  readonly action: CaliperAction;
  /** What the actor acted on. */
  readonly object: CaliperEntity;
  /** What the action made, such as an attempt or a score. */
  readonly generated?: CaliperEntity;
  /** When it happened, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly eventTime: string;
  /** The IRI of the application that the event happened in. */
  readonly edApp: string;
}
