import type { JsonObject } from "@interopkit/core/checks";
import type {
  AnyAgent,
  AnyOrganization,
  AnySession,
  CaliperEntity,
  LtiSession,
  Membership,
  Ref,
  SoftwareApplication,
} from "../entities/index.js";
import type { CaliperAction, CaliperProfile, Context } from "../internal.js";

/**
 * An event: the relationship that an actor makes with an object by an action at a time (Caliper 1.2 section 2.1). The generic
 * event holds the properties that every event has; an event of a profile narrows the type of its properties and the actions.
 *
 * @typeParam TType - The term of the event's type.
 * @typeParam TAction - The actions that the event allows.
 * @typeParam TActor - The class of the entities that may act, and every class below it.
 * @typeParam TObject - The class of the entities that may be acted on, and every class below it.
 * @typeParam TTarget - The class of the entities that may be the target, and every class below it.
 * @typeParam TGenerated - The class of the entities that the action may make, and every class below it.
 * @typeParam TReferrer - The class of the entities that may be the referrer, and every class below it.
 */
export interface Event<
  TType extends string = "Event",
  TAction extends CaliperAction = CaliperAction,
  TActor = AnyAgent,
  TObject = CaliperEntity,
  TTarget = CaliperEntity,
  TGenerated = CaliperEntity,
  TReferrer = CaliperEntity,
> {
  /** The context of the document: the Caliper context, or a list that ends with it. */
  readonly "@context": Context;
  /** The identifier of the event, a UUID as a URN: `urn:uuid:<UUID>`. */
  readonly id: string;
  /** The term of the event's type. */
  readonly type: TType;
  /** The profile that governs how the event is read. */
  readonly profile?: CaliperProfile;
  /** The agent who initiated the event. */
  readonly actor: Ref<TActor>;
  /** What the actor did. */
  readonly action: TAction;
  /** What the actor acted on. */
  readonly object: Ref<TObject>;
  /** When the event happened, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly eventTime: string;
  /** The application in which the event happened. */
  readonly edApp?: Ref<SoftwareApplication>;
  /** The entity that the action made. */
  readonly generated?: Ref<TGenerated>;
  /** A segment or a location within the object. */
  readonly target?: Ref<TTarget>;
  /** The context from which the actor came. */
  readonly referrer?: Ref<TReferrer>;
  /** The organization in whose context the event happened. */
  readonly group?: Ref<AnyOrganization>;
  /** The roles and the standing of the actor in the group. */
  readonly membership?: Ref<Membership>;
  /** The session in which the event happened. */
  readonly session?: Ref<AnySession>;
  /** The session of the platform, when an LTI platform launched the application. */
  readonly federatedSession?: Ref<LtiSession>;
  /** Attributes of the sender's own that the model does not describe. */
  readonly extensions?: JsonObject;
}
