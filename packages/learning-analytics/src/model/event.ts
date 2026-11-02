import type { CALIPER_CONTEXT } from "./context.js";
import type { CaliperEntity } from "./entities/index.js";
import type { CaliperAction, CaliperEventType, CaliperProfile } from "./terms.js";

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
